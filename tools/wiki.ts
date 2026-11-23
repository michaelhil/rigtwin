// bun run wiki index            regenerate wiki/index.md from the pages' front matter (never edit it by hand)
// bun run wiki lint             front matter, links, images and captions, stable IDs, page length, index freshness
// bun run wiki build [--out d]  render the wiki to a static HTML site (default dist/wiki); all URLs relative. Exits non-zero
//                                when a link or image of the site leads nowhere, unless --allow-broken is given
//
// The wiki is plain Markdown under wiki/ (conventions: wiki/README.md). The site needs no server-side code
// and no external service: one HTML file per page, one stylesheet, one small script with the search list.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Marked, type Token, type Tokens } from "marked";
import { ROOT, timeline } from "./timeline.ts";
import { currentVersion, type Version } from "./version.ts";

export const WIKI = join(ROOT, "wiki");
/** Section titles by folder. A folder that is not listed gets its name without the number prefix. */
const SECTIONS: Record<string, string> = {
  "00-overview": "Overview", "10-request": "Request", "20-decisions": "Decisions", "30-plan": "Plan", "40-method": "Method",
  "50-implementation": "Implementation", "60-lessons": "Lessons", "70-results": "Results", "80-reference": "Reference", "90-next": "Next",
};
const ROOT_SECTION = "About this wiki";
const STATUSES = ["stable", "living", "draft"];
const MAX_LINES = 400;
/** Stable identifiers: requirements R-, success factors SF-, decisions D-, lessons L-, failures F-, patterns P-, ideas I-, checks C-. */
const ID_SOURCE = "(?<![A-Za-z0-9_-])(?:R|SF|D|L|F|P|I|C)-\\d{2,3}(?![A-Za-z0-9_])";
/** Folder in which an ID of each kind is expected to be defined; used only to choose between candidates. */
const ID_HOME: Record<string, string> = { R: "10-request", SF: "10-request", D: "20-decisions", L: "60-lessons", F: "60-lessons", P: "60-lessons", I: "60-lessons", C: "40-method" };
/** The four pages a new reader should open first: label, folder, file-name pattern. The first match is used. */
const START_HERE: [string, string, RegExp][] = [
  ["Summary", "00-overview", /summary/], ["Lessons learned", "60-lessons", /lessons/], ["Model card", "70-results", /model-?card/], ["Next steps", "90-next", /next/],
];

export interface Finding { file: string; line: number; level: "error" | "warning"; message: string }
interface Line { n: number; raw: string; text: string; code: boolean }
interface Page {
  rel: string; file: string; folder: string; section: string; text: string; lines: string[]; bodyStart: number; body: string;
  fm: Record<string, string | string[]>; title: string; tldr: string; status: string; updated: string; tags: string[]; order: number;
  scan: Line[]; anchors: Set<string>;
}
interface IdDef { id: string; page: Page; line: number; kind: "heading" | "anchor" | "row" | "item"; text: string }

const posix = (p: string) => p.split(sep).join("/");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const sectionTitle = (folder: string) => (folder === "" ? ROOT_SECTION : SECTIONS[folder] ?? folder.replace(/^\d+-/, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()));
const stripInline = (s: string) => s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/[*`]/g, "").replace(/(?<!\w)_|_(?!\w)/g, "").trim();
/** Anchor of a heading, as the common Markdown hosts make it: lower case, punctuation dropped, spaces to hyphens. */
export const slug = (heading: string) => stripInline(heading).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");

// ------------------------------------------------------------------------------------------------ reading pages
function parseFrontMatter(lines: string[], file: string, findings: Finding[]): { fm: Record<string, string | string[]>; bodyStart: number } {
  const fm: Record<string, string | string[]> = {};
  const bad = (line: number, message: string) => findings.push({ file, line, level: "error", message });
  if ((lines[0] ?? "").trim() !== "---") { bad(1, "no front matter: the page must start with a '---' block holding title, tldr, status, updated, tags"); return { fm, bodyStart: 0 }; }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) { bad(1, "front matter is not closed with a '---' line"); return { fm, bodyStart: 0 }; }
  let key = "";
  for (let i = 1; i < end; i++) {
    const l = lines[i], m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(l);
    if (m) { key = m[1]; if (key in fm) bad(i + 1, `front matter: '${key}' is given twice`); fm[key] = /^[>|][+-]?$/.test(m[2].trim()) ? "" : m[2].trim(); }
    else if (key && /^\s+-\s+/.test(l) && (fm[key] === "" || Array.isArray(fm[key]))) fm[key] = [...(Array.isArray(fm[key]) ? (fm[key] as string[]) : []), l.replace(/^\s+-\s+/, "").trim()];
    else if (key && /^\s+\S/.test(l) && typeof fm[key] === "string") fm[key] = oneLine(`${fm[key]} ${l}`);
    else if (l.trim() && !l.trim().startsWith("#")) bad(i + 1, `front matter: cannot read this line (expected 'key: value'): ${l.trim().slice(0, 60)}`);
  }
  const unquote = (v: string) => (/^(".*"|'.*')$/.test(v) ? v.slice(1, -1) : v);
  for (const [k, v] of Object.entries(fm)) {
    if (typeof v !== "string") { fm[k] = v.map(unquote); continue; }
    const list = /^\[(.*)\]$/.exec(v);
    fm[k] = list ? list[1].split(",").map((x) => unquote(x.trim())).filter(Boolean) : unquote(v);
  }
  return { fm, bodyStart: end + 1 };
}

function validateFrontMatter(p: Page, findings: Finding[]) {
  if (!p.bodyStart) return;   // already reported as missing
  const lineOf = (key: string) => { const i = p.lines.findIndex((l, n) => n < p.bodyStart && l.startsWith(key + ":")); return i < 0 ? 1 : i + 1; };
  const bad = (key: string, message: string, level: Finding["level"] = "error") => findings.push({ file: p.rel, line: lineOf(key), level, message: `front matter: ${message}` });
  const str = (key: string) => (typeof p.fm[key] === "string" ? (p.fm[key] as string) : "");
  for (const key of ["title", "tldr", "status", "updated", "tags"]) if (!(key in p.fm)) bad(key, `'${key}' is missing`);
  if ("title" in p.fm && !str("title")) bad("title", "'title' is empty");
  if ("tldr" in p.fm && !str("tldr")) bad("tldr", "'tldr' is empty");
  else if (str("tldr").length > 420) bad("tldr", `'tldr' is ${str("tldr").length} characters; it should be one or two sentences`, "warning");
  if ("status" in p.fm && !STATUSES.includes(str("status"))) bad("status", `'status' is '${str("status")}'; use one of ${STATUSES.join(", ")}`);
  if ("updated" in p.fm) {
    const u = str("updated"), d = new Date(u + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(u) || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== u) bad("updated", `'updated' is '${u}'; use a real date written YYYY-MM-DD`);
  }
  if ("tags" in p.fm && (!Array.isArray(p.fm.tags) || !(p.fm.tags as string[]).length)) bad("tags", "'tags' must be a list with at least one entry, for example [viewer, deployment]");
  if ("order" in p.fm && !/^-?\d+(\.\d+)?$/.test(str("order"))) bad("order", "'order' must be a number");
}

/** Body lines with fenced code marked and inline code blanked, so that link and ID scans do not read code. */
function scanBody(lines: string[], bodyStart: number): Line[] {
  const out: Line[] = []; let fence: string | null = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const raw = lines[i], f = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (f && !fence) { fence = f[1]; out.push({ n: i + 1, raw, text: "", code: true }); continue; }
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && raw.trim() === f[1]) fence = null; out.push({ n: i + 1, raw, text: "", code: true }); continue; }
    const text = raw.replace(/<!--.*?-->/g, (m) => " ".repeat(m.length)).replace(/(`+)(.+?)\1(?!`)/g, (m) => " ".repeat(m.length));
    out.push({ n: i + 1, raw, text, code: false });
  }
  return out;
}

export function loadPages(findings: Finding[] = []): Page[] {
  const pages: Page[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir).sort()) {
      if (f.startsWith(".")) continue;
      const p = join(dir, f), st = statSync(p);
      if (st.isDirectory()) { if (!(dir === WIKI && f === "img")) walk(p); continue; }
      if (!f.endsWith(".md")) continue;
      const rel = posix(relative(WIKI, p)), text = readFileSync(p, "utf8"), lines = text.split("\n");
      const { fm, bodyStart } = parseFrontMatter(lines, rel, findings);
      const folder = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "";
      const str = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : "");
      const page: Page = {
        rel, file: p, folder, section: sectionTitle(folder), text, lines, bodyStart, body: lines.slice(bodyStart).join("\n"), fm,
        title: str("title") || f.replace(/\.md$/, ""), tldr: oneLine(str("tldr")), status: str("status"), updated: str("updated"),
        tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [], order: /^-?\d+(\.\d+)?$/.test(str("order")) ? Number(str("order")) : 100,
        scan: scanBody(lines, bodyStart), anchors: new Set(),
      };
      const seen = new Map<string, number>();
      for (const l of page.scan) {
        if (l.code) continue;
        const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(l.raw);
        if (h) { const s = slug(h[1]), k = seen.get(s) ?? 0; seen.set(s, k + 1); page.anchors.add(k ? `${s}-${k}` : s); }
        for (const a of l.raw.matchAll(/<[a-z][^>]*\s(?:id|name)="([^"]+)"/g)) page.anchors.add(a[1]);
      }
      pages.push(page);
    }
  };
  if (existsSync(WIKI)) walk(WIKI);
  // reading order: the index, the sections in folder order, then the pages about the wiki itself
  const rank = (p: Page) => (p.rel === "index.md" ? 0 : p.folder ? 1 : 2);
  const rootOrder = (p: Page) => (p.rel === "README.md" ? 0 : p.rel === "log.md" ? 1 : 2);
  return pages.sort((a, b) => rank(a) - rank(b) || a.folder.localeCompare(b.folder) || (a.folder ? 0 : rootOrder(a) - rootOrder(b)) || a.order - b.order || a.rel.localeCompare(b.rel));
}

// ------------------------------------------------------------------------------------------------ index
export function generateIndex(pages: Page[]): string {
  const listed = pages.filter((p) => p.rel !== "index.md");
  const latest = listed.map((p) => p.updated).filter((u) => /^\d{4}-\d{2}-\d{2}$/.test(u)).sort().pop() ?? "1970-01-01";
  const link = (p: Page, label = p.title) => `[${label.replace(/([\[\]])/g, "\\$1")}](${p.rel})`;
  const sections = [...new Set(listed.map((p) => p.folder))];
  const out: string[] = [
    "---", "title: Index",
    "tldr: Every page of this wiki with its one-line summary, section by section. Generated from the pages' front matter with `bun run wiki index`; never edited by hand.",
    "status: living", `updated: ${latest}`, "tags: [meta, generated]", "---", "",
    "# Index", "",
    "<!-- Generated by `bun run wiki index` from the front matter of the pages. Do not edit this file: edit the pages and run the command again. -->", "",
    `${listed.length} pages in ${sections.filter(Boolean).length} sections; latest page update ${latest}.`, "",
  ];
  const start = START_HERE.map(([label, folder, pattern]) => [label, listed.find((p) => p.folder === folder && pattern.test(p.rel.slice(folder.length + 1)))] as const).filter(([, p]) => p);
  if (start.length) {
    out.push("## Start here", "");
    start.forEach(([label, p], i) => out.push(`${i + 1}. **${label}:** ${link(p!)}. ${p!.tldr || "(no summary yet)"}`));
    out.push("");
  }
  for (const folder of sections) {
    out.push(`## ${sectionTitle(folder)}`, "");
    for (const p of listed.filter((x) => x.folder === folder)) out.push(`- ${link(p)}: ${p.tldr || "(no summary: front matter missing)"} *(${p.status || "no status"}, updated ${p.updated || "unknown"})*`);
    out.push("");
  }
  return out.join("\n");
}

// ------------------------------------------------------------------------------------------------ links, images, IDs
const IMG_RE = /!\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const LINK_RE = /\[((?:[^\[\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
interface Ref { line: number; kind: "link" | "image"; target: string; text: string; ownLine: boolean; inTable: boolean }

function refsOf(p: Page): Ref[] {
  const refs: Ref[] = [];
  for (const l of p.scan) {
    if (l.code) continue;
    const clean = (t: string) => t.replace(/^<|>$/g, ""), inTable = /^\s*\|/.test(l.raw);
    const images = [...l.text.matchAll(IMG_RE)];
    const withoutImages = l.text.replace(IMG_RE, (m) => "x".repeat(m.length));
    const htmlImages = [...l.text.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)];
    const rest = withoutImages.replace(/x+/g, "").replace(/\[\s*\]\([^)]*\)/g, "").replace(/<img\b[^>]*>/g, "").trim();
    const ownLine = images.length + htmlImages.length > 0 && rest === "";
    for (const m of images) refs.push({ line: l.n, kind: "image", target: clean(m[2]), text: m[1], ownLine, inTable });
    for (const m of htmlImages) refs.push({ line: l.n, kind: "image", target: m[1], text: /\balt="([^"]*)"/.exec(m[0])?.[1] ?? "", ownLine, inTable });
    for (const m of withoutImages.matchAll(LINK_RE)) refs.push({ line: l.n, kind: "link", target: clean(m[2]), text: m[1], ownLine: false, inTable });
    for (const m of l.text.matchAll(/<a\b[^>]*?\bhref="([^"]+)"/g)) refs.push({ line: l.n, kind: "link", target: m[1], text: "", ownLine: false, inTable });
    const def = /^\s{0,3}\[([^\]]+)\]:\s+(\S+)/.exec(l.text);
    if (def) refs.push({ line: l.n, kind: "link", target: clean(def[2]), text: def[1], ownLine: false, inTable });
  }
  return refs;
}

/** Where a relative reference points: a wiki page, another file of the wiki, a file elsewhere in the repository, or nowhere. */
function resolveRef(p: Page, target: string) {
  const hash = target.indexOf("#"), path = decodeURIComponent((hash < 0 ? target : target.slice(0, hash)).replace(/\?.*$/, "")), frag = hash < 0 ? "" : target.slice(hash + 1);
  const abs = path === "" ? p.file : resolve(dirname(p.file), path);
  const inWiki = abs === WIKI || abs.startsWith(WIKI + sep), inRepo = abs.startsWith(ROOT + sep);
  const exists = existsSync(abs), isDir = exists && statSync(abs).isDirectory();
  return { abs, frag, inWiki, inRepo, exists, isDir, rel: inWiki ? posix(relative(WIKI, abs)) : posix(relative(ROOT, abs)) };
}

function collectIds(pages: Page[], findings: Finding[]): Map<string, IdDef> {
  const strong = new Map<string, IdDef[]>(), weak = new Map<string, IdDef[]>(), refs = new Map<string, { page: Page; line: number }[]>();
  const add = (m: Map<string, IdDef[]>, d: IdDef) => m.set(d.id, [...(m.get(d.id) ?? []), d]);
  const one = new RegExp(ID_SOURCE), all = new RegExp(ID_SOURCE, "g");
  for (const p of pages) {
    if (p.rel === "index.md" || p.rel === "README.md") continue;   // generated; and the conventions page, which uses IDs as examples
    for (const l of p.scan) {
      if (l.code || !one.test(l.raw)) continue;
      const defs = new Set<string>(), text = stripInline(l.raw.replace(/^[\s#|>*+-]+/, "").replace(/\s*\|\s*/g, " · ")).slice(0, 160);
      const def = (kind: IdDef["kind"], id: string, isStrong: boolean) => { if (!defs.has(id)) { defs.add(id); add(isStrong ? strong : weak, { id, page: p, line: l.n, kind, text }); } };
      for (const a of l.raw.matchAll(new RegExp(`<[a-z][^>]*\\s(?:id|name)="(${ID_SOURCE})"`, "g"))) def("anchor", a[1], true);
      const h = new RegExp(`^\\s{0,3}#{1,6}\\s+(?:\\*\\*|\`)?(${ID_SOURCE})`).exec(l.raw); if (h) def("heading", h[1], true);
      const row = new RegExp(`^\\s*\\|\\s*(?:\\*\\*|\`)?(${ID_SOURCE})(?:\\*\\*|\`)?[:.]?\\s*\\|`).exec(l.raw); if (row) def("row", row[1], false);
      const item = new RegExp(`^\\s*(?:(?:[-*+]|\\d+[.)])\\s+)?\\*\\*(${ID_SOURCE})`).exec(l.raw); if (item) def("item", item[1], false);
      // a mention inside inline code is literal text (an example, a placeholder such as "the next free id `C-75`"), not a reference
      for (const m of l.text.matchAll(all)) if (!defs.has(m[0])) refs.set(m[0], [...(refs.get(m[0]) ?? []), { page: p, line: l.n }]);
    }
  }
  const defs = new Map<string, IdDef>();
  const at = (d: IdDef) => `wiki/${d.page.rel}:${d.line}`;
  for (const id of new Set([...strong.keys(), ...weak.keys()])) {
    const s = strong.get(id) ?? [], w = weak.get(id) ?? [];
    if (s.length) {
      defs.set(id, s[0]);
      for (const d of s.slice(1)) findings.push({ file: d.page.rel, line: d.line, level: "error", message: `ID ${id} is defined twice: here and at ${at(s[0])}. IDs are unique across the wiki and never reused` });
      continue;
    }
    const home = ID_HOME[id.slice(0, id.indexOf("-"))], atHome = w.filter((d) => d.page.folder === home), pool = atHome.length ? atHome : w;
    const files = [...new Set(pool.map((d) => d.page.rel))], first = pool[0];
    defs.set(id, first);
    for (const d of pool.filter((x) => x !== first && x.page === first.page && x.kind === first.kind)) findings.push({ file: d.page.rel, line: d.line, level: "error", message: `ID ${id} is defined twice on this page: here and at line ${first.line}. IDs are unique and never reused` });
    if (files.length > 1) findings.push({ file: first.page.rel, line: first.line, level: "warning", message: `ID ${id} looks defined on ${files.length} pages (${files.join(", ")}); taking this one. Define it once, under a heading, and refer to it elsewhere` });
  }
  for (const [id, list] of refs) if (!defs.has(id)) findings.push({ file: list[0].page.rel, line: list[0].line, level: "error", message: `ID ${id} is referenced${list.length > 1 ? ` (${list.length} times, first here)` : ""} but defined nowhere (a definition is a heading, a table row or a bold list item that starts with the ID)` });
  return defs;
}

// ------------------------------------------------------------------------------------------------ lint
export interface LintResult { findings: Finding[]; errors: number; warnings: number; pages: Page[]; ids: Map<string, IdDef>; summary: string }

export function lintWiki(): LintResult {
  const findings: Finding[] = [], pages = loadPages(findings);
  const byRel = new Map(pages.map((p) => [p.rel, p]));
  const usedImages = new Set<string>();
  const ids = collectIds(pages, findings);
  for (const p of pages) {
    const generated = p.rel === "index.md";
    validateFrontMatter(p, findings);
    if (!generated && p.rel !== "log.md" && p.lines.length > MAX_LINES) findings.push({ file: p.rel, line: MAX_LINES + 1, level: "warning", message: `page has ${p.lines.length} lines (guide: about ${MAX_LINES}); split it and link the parts` });
    const refs = refsOf(p), find = (level: Finding["level"], line: number, message: string) => findings.push({ file: p.rel, line, level, message });
    for (const r of refs) {
      const what = r.kind === "image" ? "image" : "link";
      if (isExternal(r.target)) { if (r.kind === "image") find("error", r.line, `image is loaded from another site (${r.target.slice(0, 60)}); keep images under wiki/img/`); continue; }
      if (r.target.startsWith("/")) { find("error", r.line, `${what} '${r.target}' starts with '/'; use a relative path so the wiki works from any folder`); continue; }
      const t = resolveRef(p, r.target);
      if (!t.exists) { find("error", r.line, `${what} '${r.target}' does not resolve (no file at ${t.inRepo ? t.inWiki ? "wiki/" + t.rel : t.rel : t.abs})`); continue; }
      if (!t.inRepo || /^(private|work|node_modules|dist)(\/|$)/.test(t.inWiki ? "" : t.rel)) { find("error", r.line, `${what} '${r.target}' points outside the published repository (${t.inRepo ? t.rel : t.abs}); such files are not committed`); continue; }
      if (r.kind === "image") {
        if (!t.inWiki) { find("error", r.line, `image '${r.target}' lies outside wiki/; images go under wiki/img/<topic>/`); continue; }
        usedImages.add(t.rel);
        if (!r.text.trim()) find("warning", r.line, `image '${r.target}' has no alternative text (the words between the square brackets)`);
        continue;
      }
      if (t.isDir && t.inWiki) { if (t.rel !== "" && !(t.rel in SECTIONS) && !pages.some((x) => x.folder === t.rel)) find("warning", r.line, `link '${r.target}' points to a folder that is not a wiki section; link to a page`); continue; }
      const target = t.inWiki ? byRel.get(t.rel) : undefined;
      if (t.frag && target && !target.anchors.has(t.frag) && ids.get(t.frag.toUpperCase())?.page !== target) find("warning", r.line, `link '${r.target}': no heading with the anchor '#${t.frag}' on ${t.rel === p.rel ? "this page" : t.rel}`);
    }
    // every image has a caption line: an italic line directly below it (several images in a row may share one)
    const body = p.scan, isImageLine = (n: number) => refs.some((r) => r.kind === "image" && r.line === n && r.ownLine);
    const seenLine = new Set<number>();
    for (const r of refs.filter((x) => x.kind === "image")) {
      if (seenLine.has(r.line)) continue; seenLine.add(r.line);
      if (r.inTable) continue;
      if (!r.ownLine) { find("warning", r.line, "image inside a sentence: put it on a line of its own with a caption line below"); continue; }
      let j = body.findIndex((l) => l.n === r.line) + 1;
      while (j < body.length && isImageLine(body[j].n)) j++;
      const direct = j < body.length && body[j].raw.trim() !== "";
      if (!direct && j < body.length) j++;
      const next = j < body.length ? body[j].raw.trim() : "";
      const italic = /^(\*(?![*\s])|_(?![_\s]))/.test(next), marked = /^(<figcaption|Figure\b|Fig\.|Caption:)/i.test(next), structural = /^(#|[-+*]\s|\d+[.)]\s|\||>|<|`{3}|~{3}|!\[|$)/.test(next);
      if (!(italic || marked || (direct && !structural))) find("error", r.line, "image without a caption line: add a line in *italics* directly below the image saying what it shows");
    }
  }
  // generated index
  const index = byRel.get("index.md"), fresh = generateIndex(pages);
  if (!index) findings.push({ file: "index.md", line: 1, level: "error", message: "wiki/index.md does not exist; run 'bun run wiki index'" });
  else if (index.text !== fresh) {
    const a = index.lines, b = fresh.split("\n"); let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    findings.push({ file: "index.md", line: i + 1, level: "error", message: "the generated index is out of date (or was edited by hand); run 'bun run wiki index'" });
  }
  const images: string[] = [];
  const walk = (d: string) => { for (const f of existsSync(d) ? readdirSync(d) : []) { const p = join(d, f); if (f.startsWith(".")) continue; statSync(p).isDirectory() ? walk(p) : /\.(png|jpe?g|gif|webp|svg)$/i.test(f) && images.push(posix(relative(WIKI, p))); } };
  walk(join(WIKI, "img"));
  const unused = images.filter((i) => !usedImages.has(i));
  findings.sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line);
  const errors = findings.filter((f) => f.level === "error").length, warnings = findings.length - errors;
  const summary = `${pages.length} pages, ${ids.size} stable IDs, ${usedImages.size} of ${images.length} images referenced${unused.length ? ` (${unused.length} not used by any page)` : ""}: ${errors} error(s), ${warnings} warning(s)`;
  return { findings, errors, warnings, pages, ids, summary };
}
export const formatFinding = (f: Finding) => `wiki/${f.file}:${f.line}: ${f.level}: ${f.message}`;

// ------------------------------------------------------------------------------------------------ site
const CSS = `
:root { color-scheme: light dark; --bg: #fff; --bg2: #f4f5f7; --fg: #1b1f25; --fg2: #59616d; --line: #dde1e6; --link: #0a58a8; --tldr: #edf4fc; --tldr-line: #0a58a8; --code: #f1f2f4; --stable: #17754a; --living: #0a58a8; --draft: #9a5600; --hit: #fff4c2; }
@media (prefers-color-scheme: dark) { :root { --bg: #14171c; --bg2: #1b1f26; --fg: #e3e6eb; --fg2: #9ba4b1; --line: #2b313a; --link: #7cb6ff; --tldr: #17263a; --tldr-line: #4a92e6; --code: #1f242c; --stable: #5fce93; --living: #7cb6ff; --draft: #e5a94c; --hit: #4d4000; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-padding-top: 4rem; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.62 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
a { color: var(--link); text-underline-offset: 2px; } a:hover { text-decoration-thickness: 2px; }
.skip { position: absolute; left: -999px; } .skip:focus { left: 8px; top: 8px; background: var(--bg); padding: 6px 10px; z-index: 30; }
.top { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 14px; height: 3rem; padding: 0 16px; background: var(--bg2); border-bottom: 1px solid var(--line); }
.top .brand { font-weight: 650; color: var(--fg); text-decoration: none; } .top .grow { flex: 1; }
.top .viewer { font-size: .9rem; white-space: nowrap; }
#nav-toggle { display: none; font: inherit; font-size: .9rem; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); cursor: pointer; }
.layout { display: grid; grid-template-columns: 17.5rem minmax(0, 1fr); }
#nav { position: sticky; top: 3rem; align-self: start; height: calc(100vh - 3rem); overflow-y: auto; padding: 14px 14px 40px 16px; border-right: 1px solid var(--line); font-size: .9rem; line-height: 1.4; }
#nav h2 { margin: 18px 0 4px; font-size: .74rem; letter-spacing: .06em; text-transform: uppercase; color: var(--fg2); font-weight: 650; }
#nav ul { list-style: none; margin: 0; padding: 0; }
#nav li a { display: block; padding: 3px 8px; border-radius: 5px; color: var(--fg); text-decoration: none; }
#nav li a:hover { background: var(--bg2); } #nav li a[aria-current] { background: var(--tldr); font-weight: 600; color: var(--link); }
#q { width: 100%; font: inherit; padding: 6px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); }
#hits { margin: 6px 0 0 !important; } #hits li a { padding: 6px 8px; } #hits small { display: block; color: var(--fg2); font-size: .8rem; }
#hits .none { padding: 6px 8px; color: var(--fg2); } #hits mark { background: var(--hit); color: inherit; }
main { min-width: 0; padding: 26px clamp(16px, 4vw, 48px) 40px; }
article { max-width: 47rem; margin: 0 auto; }
article > header h1 { margin: 2px 0 6px; font-size: 2rem; line-height: 1.2; }
.crumb { margin: 0; font-size: .82rem; letter-spacing: .05em; text-transform: uppercase; color: var(--fg2); }
.meta { margin: 0 0 18px; color: var(--fg2); font-size: .88rem; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
.badge { display: inline-block; padding: 0 9px; border: 1px solid currentColor; border-radius: 99px; font-size: .78rem; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; }
.badge.stable { color: var(--stable); } .badge.living { color: var(--living); } .badge.draft { color: var(--draft); }
.tag { padding: 0 7px; background: var(--bg2); border-radius: 4px; font-size: .8rem; }
.tldr { margin: 0 0 22px; padding: 12px 18px 12px 16px; background: var(--tldr); border-left: 4px solid var(--tldr-line); border-radius: 0 8px 8px 0; }
.tldr .label { margin: 0 0 2px; font-size: .76rem; font-weight: 700; letter-spacing: .08em; color: var(--tldr-line); }
.tldr p { margin: 4px 0; } .tldr .lead { font-size: 1.05rem; } .tldr ul { margin: 6px 0 2px; padding-left: 1.2rem; } .tldr li { margin: 3px 0; }
.toc { margin: 0 0 22px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px; font-size: .9rem; }
.toc summary { cursor: pointer; font-weight: 650; color: var(--fg2); } .toc ul { list-style: none; margin: 6px 0 2px; padding: 0; } .toc li { margin: 3px 0; line-height: 1.35; } .toc li.d3 { padding-left: 14px; font-size: .86rem; }
.toc a { text-decoration: none; } .toc a:hover { text-decoration: underline; }
.body h2 { margin: 2.1em 0 .5em; padding-bottom: .2em; border-bottom: 1px solid var(--line); font-size: 1.45rem; line-height: 1.25; }
.body h3 { margin: 1.7em 0 .4em; font-size: 1.15rem; } .body h4 { margin: 1.4em 0 .3em; font-size: 1rem; }
.body :is(h2, h3, h4) .anchor { margin-left: .4em; color: var(--fg2); text-decoration: none; opacity: 0; } .body :is(h2, h3, h4):hover .anchor, .body .anchor:focus { opacity: 1; }
.body p, .body ul, .body ol { margin: .7em 0; } .body li { margin: .25em 0; } .body li > ul, .body li > ol { margin: .2em 0; }
code { font: .88em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code); padding: .1em .35em; border-radius: 4px; overflow-wrap: anywhere; }
pre { margin: 1em 0; padding: 12px 14px; background: var(--code); border-radius: 8px; overflow-x: auto; line-height: 1.45; } pre code { background: none; padding: 0; overflow-wrap: normal; font-size: .84rem; }
blockquote { margin: 1em 0; padding: 2px 16px; border-left: 4px solid var(--line); color: var(--fg2); }
hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
.table-wrap { margin: 1em 0; overflow-x: auto; -webkit-overflow-scrolling: touch; }
table { border-collapse: collapse; font-size: .9rem; line-height: 1.45; min-width: 60%; }
th, td { padding: 6px 10px; border: 1px solid var(--line); text-align: left; vertical-align: top; } th { background: var(--bg2); font-weight: 650; white-space: nowrap; }
img { max-width: 100%; height: auto; }
figure { margin: 1.4em 0; text-align: center; } figure img { display: block; margin: 0 auto 6px; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
figure .row { display: flex; gap: 8px; justify-content: center; } figure .row > * { flex: 1; min-width: 0; }
figcaption { color: var(--fg2); font-size: .88rem; line-height: 1.45; max-width: 40rem; margin: 0 auto; }
.idref { white-space: nowrap; } .iddef { font-weight: 650; scroll-margin-top: 4rem; }
.repo-path { border-bottom: 1px dotted var(--fg2); cursor: help; }
.pager { display: flex; gap: 12px; margin: 3em 0 0; padding-top: 16px; border-top: 1px solid var(--line); }
.pager a { flex: 1; min-width: 0; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; text-decoration: none; } .pager a:hover { border-color: var(--link); }
.pager small { display: block; color: var(--fg2); font-size: .78rem; } .pager .next { text-align: right; }
.foot { max-width: 47rem; margin: 2.2em auto 0; color: var(--fg2); font-size: .82rem; }
@media (min-width: 1320px) {
  article { max-width: 64rem; display: grid; grid-template-columns: minmax(0, 47rem) 15rem; column-gap: 2rem; align-items: start; }
  article > * { grid-column: 1; } .foot { max-width: 64rem; }
  .toc { grid-column: 2; grid-row: 1 / span 6; position: sticky; top: 4.5rem; max-height: calc(100vh - 6rem); overflow-y: auto; margin: 0; border: 0; border-left: 1px solid var(--line); border-radius: 0; }
  .toc summary { list-style: none; cursor: default; pointer-events: none; } .toc summary::-webkit-details-marker { display: none; }
}
@media (max-width: 899px) {
  #nav-toggle { display: block; } .layout { display: block; }
  #nav { display: none; position: fixed; top: 3rem; left: 0; z-index: 15; width: min(20rem, 88vw); background: var(--bg); box-shadow: 4px 0 18px rgba(0, 0, 0, .25); }
  body.nav-open #nav { display: block; } article > header h1 { font-size: 1.6rem; }
}
@media print { .top, #nav, .pager, .toc, .skip { display: none !important; } .layout { display: block; } main { padding: 0; } }
`;

/** Search over titles, summaries and tags; menu button; the page list is filled in by the build. */
const JS = `(function () {
  var pages = __PAGES__, root = document.body.dataset.root || '', q = document.getElementById('q'), hits = document.getElementById('hits');
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mark(s, words) { var out = esc(s); words.forEach(function (w) { out = out.replace(new RegExp('(' + esc(w).replace(/[.*+?^$()|[\\]{}\\\\]/g, '\\\\$&') + ')(?![^<]*>)', 'ig'), '<mark>$1</mark>'); }); return out; }
  function search() {
    var words = q.value.toLowerCase().split(/\\s+/).filter(Boolean);
    if (!words.length) { hits.hidden = true; hits.innerHTML = ''; return; }
    var found = pages.map(function (p) {
      var title = p.t.toLowerCase(), all = title + ' ' + p.d.toLowerCase() + ' ' + p.g.toLowerCase() + ' ' + p.s.toLowerCase(), score = 0;
      for (var i = 0; i < words.length; i++) { if (all.indexOf(words[i]) < 0) return null; score += title.indexOf(words[i]) >= 0 ? 3 : 1; }
      return { p: p, score: score };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
    hits.hidden = false;
    hits.innerHTML = found.length ? found.map(function (f) { return '<li><a href="' + root + f.p.u + '">' + mark(f.p.t, words) + '<small>' + mark(f.p.d, words) + '</small></a></li>'; }).join('') : '<li class="none">No page matches.</li>';
  }
  if (q) {
    q.addEventListener('input', search);
    q.addEventListener('keydown', function (e) { var first = hits.querySelector('a'); if (e.key === 'Enter' && first) location.href = first.href; if (e.key === 'Escape') { q.value = ''; search(); } });
    document.addEventListener('keydown', function (e) { if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); document.body.classList.add('nav-open'); q.focus(); } });
  }
  var toggle = document.getElementById('nav-toggle');
  if (toggle) toggle.addEventListener('click', function () { var open = document.body.classList.toggle('nav-open'); toggle.setAttribute('aria-expanded', String(open)); });
  var toc = document.querySelector('details.toc');
  if (toc && window.matchMedia('(max-width: 1319px)').matches) toc.open = false;
  var current = document.querySelector('#nav a[aria-current]');
  if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
})();
`;

interface SiteCtx { pages: Page[]; byRel: Map<string, Page>; ids: Map<string, IdDef>; version: Version; notes: string[] }
const htmlPath = (rel: string) => rel.replace(/\.md$/, ".html");
const rootOf = (p: Page) => "../".repeat(p.rel.split("/").length - 1);

function renderBody(p: Page, ctx: SiteCtx, bodyText: string) {
  const toc: { depth: number; id: string; text: string }[] = [], used = new Map<string, number>(), root = rootOf(p);
  const uniqueId = (text: string) => { const s = slug(text) || "section", k = used.get(s) ?? 0; used.set(s, k + 1); return k ? `${s}-${k}` : s; };
  /** Relative link as written in the Markdown source to the link in the site; null when the target is not part of the site. */
  const href = (target: string): string | null => {
    if (isExternal(target) || target.startsWith("#")) return target;
    const t = resolveRef(p, target), frag = t.frag ? "#" + t.frag : "";
    if (!t.inWiki) return null;
    if (t.isDir) return t.rel === "" ? `${root}index.html` : `${root}index.html#${slug(sectionTitle(t.rel))}`;
    const hash = target.indexOf("#"), path = hash < 0 ? target : target.slice(0, hash);
    return (t.rel.endsWith(".md") ? path.replace(/\.md$/, ".html") : path) + frag;
  };
  const md = new Marked({ gfm: true });
  const image = (t: Tokens.Image, zoom: boolean) => { const img = `<img src="${esc(t.href)}" alt="${esc(t.text)}" loading="lazy"${t.title ? ` title="${esc(t.title)}"` : ""}>`; return zoom && !isExternal(t.href) ? `<a href="${esc(t.href)}" title="Open the image at full size">${img}</a>` : img; };
  md.use({ renderer: {
    heading(t: Tokens.Heading) {
      const id = uniqueId(t.text), inner = this.parser.parseInline(t.tokens);
      if (t.depth === 2 || t.depth === 3) toc.push({ depth: t.depth, id, text: inner.replace(/<[^>]+>/g, "") });
      return `<h${t.depth} id="${esc(id)}">${inner}<a class="anchor" href="#${esc(id)}" aria-label="Link to this section">#</a></h${t.depth}>\n`;
    },
    link(t: Tokens.Link) {
      const inner = this.parser.parseInline(t.tokens), to = href(t.href);
      if (to === null) { ctx.notes.push(`${p.rel}: link to '${t.href}' (a repository file outside the wiki) is shown as text`); return `<span class="repo-path" title="File in the source repository: ${esc(resolveRef(p, t.href).rel)}">${inner}</span>`; }
      return `<a href="${esc(to)}"${t.title ? ` title="${esc(t.title)}"` : ""}>${inner}</a>`;
    },
    image(t: Tokens.Image) { return image(t, false); },
    paragraph(t: Tokens.Paragraph) {
      // an image (or a row of images) on its own line, with the caption line below it, becomes a figure
      const tokens = t.tokens ?? [], isImg = (x: Token) => x.type === "image" || (x.type === "link" && (x as Tokens.Link).tokens.length === 1 && (x as Tokens.Link).tokens[0].type === "image");
      const blank = (x: Token) => x.type === "br" || (x.type === "text" && !(x as Tokens.Text).text.trim());
      let n = 0; while (n < tokens.length && (isImg(tokens[n]) || blank(tokens[n]))) n++;
      const lead = tokens.slice(0, n).filter(isImg), rest = tokens.slice(n);
      if (!lead.length) return false;
      if (rest.length && !(rest[0].type === "em" || (rest[0].type === "text" && /^\s*\n/.test((rest[0] as Tokens.Text).raw)))) return false;
      const pics = lead.map((x) => (x.type === "image" ? image(x as Tokens.Image, true) : this.parser.parseInline([x])));
      const capTokens = rest.length === 1 && rest[0].type === "em" ? (rest[0] as Tokens.Em).tokens : rest;
      const caption = capTokens.length ? `<figcaption>${this.parser.parseInline(capTokens).trim()}</figcaption>` : "";
      return `<figure>${pics.length > 1 ? `<div class="row">${pics.join("")}</div>` : pics[0]}${caption}</figure>\n`;
    },
  } });
  let tokens = md.lexer(bodyText) as Token[];
  // an image paragraph followed by a paragraph that is only an italic line: the italic line is the caption
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i]; if (a.type !== "paragraph") continue;
    const onlyImages = (a as Tokens.Paragraph).tokens.every((x) => x.type === "image" || x.type === "br" || (x.type === "text" && !(x as Tokens.Text).text.trim()));
    let j = i + 1; while (j < tokens.length && tokens[j].type === "space") j++;
    const b = tokens[j] as Tokens.Paragraph | undefined;
    if (onlyImages && b?.type === "paragraph" && b.tokens.length === 1 && b.tokens[0].type === "em") { (a as Tokens.Paragraph).tokens.push({ type: "br", raw: "\n" } as Tokens.Br, ...b.tokens); tokens.splice(i + 1, j - i); }
  }
  // the page title comes from the front matter; the body's own first-level heading would repeat it
  const firstReal = tokens.findIndex((t) => t.type !== "space");
  let titleId = "";
  if (firstReal >= 0 && tokens[firstReal].type === "heading" && (tokens[firstReal] as Tokens.Heading).depth === 1) { titleId = uniqueId((tokens[firstReal] as Tokens.Heading).text); tokens = tokens.filter((_, i) => i !== firstReal); }
  // a leading "TL;DR" section moves into the highlighted block
  let tldr: Token[] = [], tldrId = "";
  const h = tokens.findIndex((t) => t.type === "heading");
  if (h >= 0 && /^TL;?DR\b/i.test((tokens[h] as Tokens.Heading).text.trim())) {
    let e = h + 1; while (e < tokens.length && tokens[e].type !== "heading" && tokens[e].type !== "hr") e++;
    tldrId = uniqueId((tokens[h] as Tokens.Heading).text); tldr = tokens.slice(h + 1, e); tokens = [...tokens.slice(0, h), ...tokens.slice(e)];
  }
  const parse = (list: Token[]) => md.parser(list);
  return { html: parse(tokens), tldrHtml: tldr.length ? parse(tldr) : "", toc, titleId, tldrId };
}

/** Wrap tables for sideways scrolling, give each defined ID an anchor, and turn every other mention of an ID into a link to its definition. */
function postProcess(html: string, p: Page, ctx: SiteCtx): string {
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
  for (const d of ctx.ids.values()) {
    if (d.page !== p || d.kind === "anchor") continue;
    // also reachable in lower case (#l-07), unless the page already has that anchor (`<a id="l-07"></a>` above the definition)
    const lower = p.anchors.has(d.id.toLowerCase()) ? "" : `<a id="${d.id.toLowerCase()}"></a>`;
    const id = d.id.replace("-", "\\-"), span = `${lower}<span class="iddef" id="${d.id}">${d.id}</span>`, anchors = `(?:<a (?:id|name)="[^"]*"></a>\\s*)*`;
    const re = d.kind === "heading" ? new RegExp(`(<h[1-6][^>]*>\\s*${anchors}(?:<strong>|<code>)?)${id}(?![A-Za-z0-9_])`) : d.kind === "row" ? new RegExp(`(<tr>\\s*<t[dh][^>]*>\\s*${anchors}(?:<strong>|<code>)?)${id}(?![A-Za-z0-9_])`) : new RegExp(`(<(?:li|p)>\\s*(?:<p>)?${anchors}<strong>)${id}(?![A-Za-z0-9_])`);
    html = html.replace(re, (_, pre) => pre + span);
  }
  const all = new RegExp(ID_SOURCE, "g"), from = dirname(p.rel);
  let skip = 0, out = "";
  for (const part of html.split(/(<[^>]+>)/)) {
    if (part.startsWith("<")) {
      if (/^<(a|code|pre|script|style)\b/i.test(part) || /^<span class="iddef"/.test(part)) skip++;
      else if (/^<\/(a|code|pre|script|style)>/i.test(part) || (part === "</span>" && skip > 0 && /<span class="iddef"[^>]*>[^<]*$/.test(out))) skip = Math.max(0, skip - 1);
      out += part; continue;
    }
    out += skip ? part : part.replace(all, (id) => {
      const d = ctx.ids.get(id); if (!d) return id;
      const to = (d.page === p ? "" : posix(relative(from, htmlPath(d.page.rel)))) + "#" + id;
      return `<a class="idref" href="${esc(to)}" title="${esc(d.text)}">${id}</a>`;
    });
  }
  return out;
}

function renderPage(p: Page, ctx: SiteCtx, bodyText: string): string {
  const root = rootOf(p), { html, tldrHtml, toc, titleId, tldrId } = renderBody(p, ctx, bodyText);
  const seq = ctx.pages, i = seq.indexOf(p), prev = seq[i - 1], next = seq[i + 1];
  const to = (q: Page) => root + htmlPath(q.rel);
  const nav: string[] = [];
  for (const folder of [...new Set(seq.filter((x) => x.rel !== "index.md").map((x) => x.folder))]) {
    const items = seq.filter((x) => x.folder === folder && x.rel !== "index.md");
    if (!items.length) continue;
    nav.push(`<h2>${esc(sectionTitle(folder))}</h2><ul>${items.map((x) => `<li><a href="${esc(to(x))}"${x === p ? ' aria-current="page"' : ""}>${esc(x.title)}</a></li>`).join("")}</ul>`);
  }
  const status = STATUSES.includes(p.status) ? `<span class="badge ${p.status}">${p.status}</span>` : "";
  const pager = prev || next ? `<nav class="pager" aria-label="Previous and next page">${prev ? `<a class="prev" href="${esc(to(prev))}"><small>← Previous</small>${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a class="next" href="${esc(to(next))}"><small>Next →</small>${esc(next.title)}</a>` : ""}</nav>` : "";
  const article = postProcess(`<div class="tldr"${tldrId ? ` id="${tldrId}"` : ""}><p class="label">TL;DR</p><p class="lead">${new Marked().parseInline(p.tldr || "No summary yet.") as string}</p>${tldrHtml}</div>
${toc.length > 1 ? `<details class="toc" open><summary>On this page</summary><ul>${toc.map((t) => `<li class="d${t.depth}"><a href="#${esc(t.id)}">${t.text}</a></li>`).join("")}</ul></details>` : ""}
<div class="body">
${html}</div>`, p, ctx);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(p.title)} · rigtwin wiki</title>
<meta name="description" content="${esc(p.tldr)}">
<link rel="stylesheet" href="${root}assets/wiki.css">
</head>
<body data-root="${root}">
<a class="skip" href="#content">Skip to the page</a>
<div class="top"><button id="nav-toggle" type="button" aria-controls="nav" aria-expanded="false">Menu</button><a class="brand" href="${root}index.html">rigtwin wiki</a><span class="grow"></span><a class="viewer" href="${root}../">Open the 3D viewer</a></div>
<div class="layout">
<nav id="nav" aria-label="Wiki pages">
<input id="q" type="search" placeholder="Search titles and summaries" aria-label="Search the wiki" autocomplete="off">
<ul id="hits" hidden></ul>
<ul style="margin-top:12px"><li><a href="${root}index.html"${p.rel === "index.md" ? ' aria-current="page"' : ""}>Index of all pages</a></li><li><a href="${root}../">← 3D viewer</a></li></ul>
${nav.join("\n")}
</nav>
<main id="content">
<article>
<header><p class="crumb">${esc(p.rel === "index.md" ? "rigtwin" : p.section)}</p><h1${titleId ? ` id="${esc(titleId)}"` : ""}>${esc(p.title)}</h1>
<p class="meta">${status}${p.updated ? `<span>Last updated <time datetime="${esc(p.updated)}">${esc(p.updated)}</time></span>` : ""}${p.tags.length ? `<span>${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}</span>` : ""}</p></header>
${article}
${pager}
</article>
<p class="foot">rigtwin wiki · version ${esc(ctx.version.short)} · generated from the Markdown pages in the repository's <code>wiki/</code> folder · <a href="${root}../">3D viewer</a></p>
</main>
</div>
<script src="${root}assets/wiki.js"></script>
</body>
</html>
`;
}

/** Every href and src of the built pages must lead to a file of the site (or up to the viewer). Returns the problems found. */
export function checkSite(out: string): string[] {
  const problems: string[] = [], files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  walk(out);
  const idsOf = new Map<string, Set<string>>();
  const ids = (file: string) => { if (!idsOf.has(file)) idsOf.set(file, new Set([...readFileSync(file, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))); return idsOf.get(file)!; };
  for (const f of files.filter((x) => x.endsWith(".html"))) {
    const html = readFileSync(f, "utf8"), where = posix(relative(out, f));
    if (!/<meta name="robots" content="noindex/.test(html)) problems.push(`${where}: no noindex robots meta`);
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const url = m[1].replace(/&amp;/g, "&");
      if (isExternal(url)) { if (m[0].trimStart().startsWith("src")) problems.push(`${where}: loads ${url} from another site`); continue; }
      if (url.startsWith("/")) { problems.push(`${where}: absolute URL ${url}`); continue; }
      const hash = url.indexOf("#"), path = decodeURIComponent(hash < 0 ? url : url.slice(0, hash)), frag = hash < 0 ? "" : decodeURIComponent(url.slice(hash + 1));
      let target = path === "" ? f : resolve(dirname(f), path);
      if (target === dirname(out)) continue;                                   // up to the viewer
      if (!target.startsWith(out + sep) && target !== out) { problems.push(`${where}: ${url} leaves the site`); continue; }
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
      if (!existsSync(target)) { problems.push(`${where}: ${url} does not exist in the site`); continue; }
      if (frag && target.endsWith(".html") && !ids(target).has(frag)) problems.push(`${where}: ${url} has no element with that id`);
    }
  }
  return problems;
}

export interface BuildResult { out: string; pages: number; files: number; bytes: number; seconds: number; problems: string[]; notes: string[]; indexStale: boolean; pageUrls: string[] }

export function buildWiki(opts: { out?: string; version?: Version } = {}): BuildResult {
  const t0 = performance.now(), out = resolve(opts.out ?? join(ROOT, "dist", "wiki"));
  if (out === WIKI || WIKI.startsWith(out + sep) || out.startsWith(WIKI + sep) || !out.startsWith(ROOT + sep)) throw new Error(`refusing to build the wiki site into ${out}`);
  const findings: Finding[] = [], pages = loadPages(findings), fresh = generateIndex(pages);
  const ids = collectIds(pages, []);
  // the index page of the site is always the freshly generated one, whatever is on disk
  let index = pages.find((p) => p.rel === "index.md");
  const indexStale = !index || index.text !== fresh;
  if (!index) { index = { ...pages[0], rel: "index.md", file: join(WIKI, "index.md"), folder: "", section: ROOT_SECTION, anchors: new Set(), scan: [] } as Page; pages.unshift(index); }
  const lines = fresh.split("\n"), fm = parseFrontMatter(lines, "index.md", []);
  Object.assign(index, { text: fresh, lines, bodyStart: fm.bodyStart, body: lines.slice(fm.bodyStart).join("\n"), fm: fm.fm, title: "Index", tldr: String(fm.fm.tldr ?? ""), status: "living", updated: String(fm.fm.updated ?? ""), tags: fm.fm.tags as string[] });
  const ctx: SiteCtx = { pages, byRel: new Map(pages.map((p) => [p.rel, p])), ids, version: opts.version ?? currentVersion(), notes: [] };
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "assets"), { recursive: true });
  let files = 0, bytes = 0;
  const write = (rel: string, content: string) => { const f = join(out, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); files++; bytes += Buffer.byteLength(content); };
  for (const p of pages) write(htmlPath(p.rel), renderPage(p, ctx, p.body));
  write("assets/wiki.css", CSS.trimStart());
  const list = pages.map((p) => ({ t: p.title, d: p.tldr, u: htmlPath(p.rel), s: p.rel === "index.md" ? "" : p.section, g: p.tags.join(" ") }));
  write("assets/wiki.js", JS.replace("__PAGES__", () => JSON.stringify(list).replace(/</g, "\\u003c")));
  // everything else in the wiki that is not a page (images above all) is copied as it is
  const copy = (dir: string) => {
    for (const f of readdirSync(dir)) {
      if (f.startsWith(".")) continue;
      const src = join(dir, f), st = statSync(src), rel = relative(WIKI, src);
      if (st.isDirectory()) { copy(src); continue; }
      if (f.endsWith(".md")) continue;
      if (rel.split(sep)[0] === "assets") throw new Error("wiki/assets/ collides with the site's own assets folder; rename it");
      mkdirSync(dirname(join(out, rel)), { recursive: true }); copyFileSync(src, join(out, rel)); files++; bytes += st.size;
    }
  };
  copy(WIKI);
  const problems = checkSite(out);
  return { out, pages: pages.length, files, bytes, seconds: (performance.now() - t0) / 1000, problems, notes: [...new Set(ctx.notes)], indexStale, pageUrls: pages.map((p) => htmlPath(p.rel)) };
}

// ------------------------------------------------------------------------------------------------ command line
if (import.meta.main) {
  const args = process.argv.slice(2), cmd = args[0], opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const t0 = performance.now(), secs = () => (performance.now() - t0) / 1000;
  if (cmd === "index") {
    const pages = loadPages(), text = generateIndex(pages), file = join(WIKI, "index.md");
    const changed = !existsSync(file) || readFileSync(file, "utf8") !== text;
    if (changed) writeFileSync(file, text);
    console.log(`wiki index: ${pages.filter((p) => p.rel !== "index.md").length} pages listed, wiki/index.md ${changed ? "written" : "already up to date"} (${secs().toFixed(2)} s)`);
    timeline("wiki index", secs(), `${pages.length} pages, ${changed ? "written" : "unchanged"}`);
  } else if (cmd === "lint") {
    const r = lintWiki();
    for (const f of r.findings) console.log(formatFinding(f));
    console.log(`wiki lint: ${r.summary} (${secs().toFixed(2)} s)`);
    timeline(r.errors ? "wiki lint failed" : "wiki lint", secs(), r.summary);
    process.exit(r.errors ? 1 : 0);
  } else if (cmd === "build") {
    const r = buildWiki({ out: opt("--out") ? resolve(ROOT, opt("--out")!) : undefined });
    if (r.indexStale) console.log("note: wiki/index.md is out of date; the site uses a freshly generated index (run 'bun run wiki index' to update the file)");
    if (!args.includes("--quiet")) for (const n of r.notes) console.log("note: " + n);
    const quiet = args.includes("--quiet"), shown = quiet ? r.problems.slice(0, 5) : r.problems;
    for (const p of shown) console.log("broken: " + p);
    if (shown.length < r.problems.length) console.log(`broken: … and ${r.problems.length - shown.length} more (without --quiet every one is listed)`);
    console.log(`wiki build: ${r.pages} pages, ${r.files} files, ${(r.bytes / 1e6).toFixed(2)} MB → ${relative(ROOT, r.out)}: ${r.problems.length ? `${r.problems.length} broken link(s)` : "all links and images of the site resolve"} (${r.seconds.toFixed(2)} s)`);
    const allow = args.includes("--allow-broken");
    if (r.problems.length && allow) console.log("--allow-broken: the site is written although some of its links lead nowhere");
    timeline(r.problems.length && !allow ? "wiki build failed" : "wiki build", r.seconds, `${r.pages} pages, ${r.files} files, ${r.bytes} bytes, ${r.problems.length} broken links${allow ? " (allowed)" : ""}`);
    process.exit(r.problems.length && !allow ? 1 : 0);
  } else {
    console.error("usage: bun run wiki index | lint | build [--out <dir>] [--quiet] [--allow-broken]");
    process.exit(2);
  }
}
