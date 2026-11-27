// Local project pages (Project details…). Scene links open the same editor that agents use.
import { h, link } from "./dom.ts";
import { action, brand, field, icon, select } from "./room-controls.ts";
import {
  PROJECT_BODY_BYTES,
  type ProjectDetail,
  type ProjectPackage,
  type ProjectSummary,
  type ReleaseMode,
  type WorkspaceSummary,
} from "../../shared/project.ts";

class ProjectRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
async function call<T>(id: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch("/api/projects/command", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Synergon": "1" },
    body: JSON.stringify({ id: "project." + id, args }),
  });
  const data = await r.json();
  if (!r.ok)
    throw new ProjectRequestError(
      data.error?.code,
      [data.error?.message, data.error?.hint].filter(Boolean).join(" ") || "Could not open this project.",
    );
  return data as T;
}
const url = (id: string) => "/projects/" + encodeURIComponent(id);
function textField(value = "", placeholder = "") {
  const e = h("input");
  e.value = value;
  e.placeholder = placeholder;
  e.required = true;
  return e;
}
function disclosure(label: string, ...children: Node[]) {
  return h("details", "pr-section", h("summary", null, label), ...children);
}
function row(label: string, href: string, detail?: string) {
  const el = link("", href, "rm-directory-row");
  el.append(icon("folder"), h("span", null, label, detail && h("small", null, detail)), icon("next"));
  return el;
}
export async function startProjectApp() {
  document.body.className = "room-app";
  document.documentElement.classList.remove("page");
  // This module is loaded only on private local project routes.
  const style = h("style");
  style.textContent = `
    .pr-shell{max-width:700px;margin:clamp(36px,7vh,72px) auto 32px}.pr-shell h1{margin:8px 0 12px}
    .pr-shell h2{font-size:18px;margin:22px 0 6px}.pr-shell .rm-help{margin:8px 0 14px}
    .pr-shell .pr-section{border-top:1px solid var(--rm-faint);padding:12px 0}.pr-section summary{cursor:pointer;font-weight:600}
    .pr-shell .rm-field{display:grid;gap:4px;margin:9px 0;min-width:0}.pr-shell input,.pr-shell select,.pr-shell textarea{box-sizing:border-box;width:100%;padding:7px 10px;font:inherit;border:1px solid #c5d0c4;border-radius:4px;background:#fff;min-height:36px}
    .pr-shell textarea{min-height:150px;resize:vertical;font-family:monospace}.pr-shell .rm-field-label,.pr-shell small{display:block;font-size:12px;overflow-wrap:anywhere}
    .pr-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.pr-results{max-height:45vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
    .pr-shell nav{display:flex;gap:14px}.pr-shell a{color:var(--rm-accent)}.pr-status:not(:empty){margin:12px 0}
  `;
  document.head.append(style);
  const shell = h("main", "rm-directory"),
    main = h("div", "pr-shell");
  const status = h("p", "pr-status");
  status.setAttribute("role", "status");
  const contents = h("div");
  main.append(
    h("nav", null, link("Projects", "/projects")),
    status,
    contents,
  );
  shell.append(brand(), main);
  document.body.replaceChildren(shell);
  const report = (msg: string, error = false) => {
    status.textContent = msg;
    status.classList.toggle("rm-error", error);
  };
  function button(label: string, run: () => Promise<void>, primary = false) {
    const btn = action(
      label,
      () => {
        btn.disabled = true;
        report("");
        void run()
          .catch((e) => report(e instanceof Error ? e.message : String(e), true))
          .finally(() => {
            btn.disabled = false;
          });
      },
      undefined,
      primary ? "rm-primary" : "",
    );
    return btn;
  }
  function form(label: string, items: Node[], run: () => Promise<void>) {
    const submit = h("button", "rm-button rm-primary", label);
    submit.type = "submit";
    const f = h("form", null, ...items, submit);
    f.onsubmit = (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      report("");
      void run()
        .catch((e) => report(e.message, true))
        .finally(() => {
          submit.disabled = false;
        });
    };
    return f;
  }
  // Workspace names, read once: the pages say which workspace holds a project.
  let workspaces: WorkspaceSummary[] = [];
  const workspaceName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? "Workspace";
  function directory(projects: ProjectSummary[]) {
    document.title = "Projects · Synergon";
    const title = textField("", "Control room study"),
      folder = textField("", "Customer/Study"),
      workspace = select(
        "Workspace",
        workspaces.map((w) => ({ value: w.id, label: w.name })),
      );
    folder.required = false;
    const create = form(
      "Create project",
      [
        field("Project name", title),
        ...(workspaces.length > 1 ? [field("Workspace", workspace)] : []),
        field("Folder (optional)", folder),
      ],
      async () => {
        const p = await call<ProjectDetail>("create", {
          name: title.value,
          ...(workspaces.length > 1 ? { workspace: workspace.value } : {}),
          ...(folder.value ? { folder: folder.value } : {}),
        });
        location.assign(url(p.id));
      },
    );
    const file = h("input");
    file.type = "file";
    file.accept = ".json,.synergon,application/json";
    file.required = true;
    const importFolder = textField("", "Customer/Received study");
    importFolder.required = false;
    let pending: ProjectPackage | undefined;
    const copy = button("Import as separate copy", async () => {
      if (!pending) return;
      const r = await call<{ project: ProjectDetail }>("import", {
        package: pending,
        separateCopy: true,
        ...(importFolder.value ? { folder: importFolder.value } : {}),
      });
      location.assign(url(r.project.id));
    });
    copy.hidden = true;
    file.onchange = () => {
      pending = undefined;
      copy.hidden = true;
      report("");
    };
    const upload = form(
      "Import project",
      [field("Project package", file), field("Destination folder (optional)", importFolder)],
      async () => {
        const selected = file.files?.[0];
        if (!selected) return;
        if (selected.size > PROJECT_BODY_BYTES) throw new Error("Package exceeds the local import size limit.");
        const data = JSON.parse(await selected.text());
        try {
          const r = await call<{ project: ProjectDetail }>("import", {
            package: data,
            ...(importFolder.value ? { folder: importFolder.value } : {}),
          });
          location.assign(url(r.project.id));
        } catch (e) {
          if (e instanceof ProjectRequestError && e.code === "project_conflict") {
            pending = data;
            copy.hidden = false;
          }
          throw e;
        }
      },
    );
    contents.replaceChildren(
      h("h1", null, "Projects"),
      projects.length
        ? h(
            "div",
            "rm-directory-list",
            ...projects.map((p) => row(p.name, url(p.id), workspaceName(p.workspace) + " · " + p.folder)),
          )
        : h("p", "rm-help", "Create a project or import a colleague’s package."),
      disclosure("New project", create),
      disclosure("Import project", upload, copy),
    );
  }
  function detail(p: ProjectDetail) {
    document.title = p.name + " · Synergon";
    const update = async (cmd: string, args: Record<string, unknown>, message: string) => {
      detail(await call<ProjectDetail>(cmd, { project: p.id, ...args }));
      report(message);
    };
    let next = 1;
    while (p.scenes.some((s) => s.name === "Scene " + next)) next++;
    const sceneName = textField("", "Scene " + next),
      template = select("Starting layout", [
        { value: "empty", label: "Empty room" },
        { value: "demo", label: "Furnished control room" },
      ]);
    sceneName.required = false;
    // Named versions refer to a scene by its portable ID.
    const sceneOf = (key: string) => p.scenes.find((s) => s.portable === key || s.id === key);
    const first = p.scenes[0],
      sceneChoice = () =>
        select(
          "Scene",
          p.scenes.map((s) => ({ value: s.id, label: s.name })),
          first?.id,
        );
    const versionScene = sceneChoice(),
      versionName = textField();
    const version = select(
      "Named version",
      p.versions.map((v) => ({
        value: v.id,
        label: (sceneOf(v.scene)?.name ?? "Scene") + " · " + v.name + " · r" + v.revision,
      })),
    );
    const other = h("select");
    other.setAttribute("aria-label", "Compare with");
    const renderOthers = () => {
      other.replaceChildren(new Option("Current scene", ""));
      const from = p.versions.find((v) => v.id === version.value);
      for (const v of p.versions.filter((v) => v.scene === from?.scene && v.id !== from?.id))
        other.add(new Option(v.name + " · r" + v.revision, v.id));
    };
    version.onchange = renderOthers;
    renderOthers();
    const results = h("pre", "pr-results");
    results.setAttribute("aria-live", "polite");
    const compare = button("Compare", async () => {
      const comparison = await call<{ changes: { path: string; before: unknown; after: unknown }[] }>("compare", {
        project: p.id,
        version: version.value,
        ...(other.value ? { other: other.value } : {}),
      });
      results.textContent = comparison.changes.length
        ? comparison.changes
            .map((c) => c.path + "\n" + JSON.stringify(c.before) + " → " + JSON.stringify(c.after))
            .join("\n\n")
        : "The layouts are identical.";
    });
    const restore = button("Restore selected version", async () => {
      const v = p.versions.find((v) => v.id === version.value)!,
        scene = sceneOf(v.scene)!;
      if (
        !window.confirm(
          "Restore “" +
            v.name +
            "” to " +
            scene.name +
            "? This replaces its current layout and begins a new undo history.",
        )
      )
        return;
      await update("restore", { version: v.id, expectedVersion: scene.revision }, "Version restored.");
    });
    const versions = h(
      "div",
      null,
      form("Save named version", [field("Scene", versionScene), field("Version name", versionName)], async () => {
        const v = p.scenes.find((s) => s.id === versionScene.value)!;
        await update("save", { scene: v.id, name: versionName.value, expectedVersion: v.revision }, "Version saved.");
      }),
    );
    if (p.versions.length)
      versions.append(
        field("Named version", version),
        field("Compare with", other),
        h("div", "pr-actions", compare, restore),
        results,
      );
    const record = h("textarea");
    record.value = p.markdown;
    const folder = textField(p.folder),
      title = textField(p.name);
    const transfer = h("div"),
      choices = new Map<string, HTMLSelectElement>();
    for (const d of p.dependencies) {
      const options = d.redistributable
        ? [
            { value: "embed", label: "Embed pinned files" },
            { value: "link", label: "Link exact release" },
          ]
        : [{ value: "link", label: "Link required · supply authorized files" }];
      const choice = select(d.pin, options);
      choices.set(d.pin, choice);
      transfer.append(field(d.pin, choice));
    }
    transfer.append(
      button(
        "Download project package",
        async () => {
          const modes = Object.fromEntries([...choices].map(([pin, choice]) => [pin, choice.value as ReleaseMode]));
          const pkg = await call<ProjectPackage>("export", { project: p.id, modes });
          const blob = URL.createObjectURL(new Blob([JSON.stringify(pkg)], { type: "application/json" })),
            anchor = link("Download", blob);
          anchor.download = p.name.replace(/[^a-z0-9_.-]+/gi, "-") + ".synergon.json";
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(blob), 1000);
          report("Project package downloaded.");
        },
        true,
      ),
    );
    contents.replaceChildren(
      h("h1", null, p.name),
      h("p", "rm-help", "In " + workspaceName(p.workspace) + " · folder " + p.folder),
      h("h2", null, "Scenes"),
      h(
        "div",
        "rm-directory-list",
        ...p.scenes.map((s) => row(s.name, "/workspaces/" + encodeURIComponent(s.id), "Revision " + s.revision)),
      ),
      disclosure(
        "Add scene",
        form("Create scene", [field("Scene name", sceneName), field("Starting layout", template)], () =>
          update(
            "scene",
            { ...(sceneName.value.trim() ? { name: sceneName.value.trim() } : {}), template: template.value },
            "Scene added.",
          ),
        ),
      ),
      disclosure("Named versions", versions),
      disclosure(
        "Project record",
        form("Save project record", [field("project.md", record)], () =>
          update("record", { markdown: record.value, previous: p.markdown }, "Project record saved."),
        ),
      ),
      disclosure("Export project", transfer),
      disclosure(
        "Project settings",
        form("Rename project", [field("Project name", title)], () =>
          update("rename", { name: title.value }, "Project renamed."),
        ),
        form("Move folder", [field("Folder", folder)], () =>
          update("move", { folder: folder.value }, "Project moved."),
        ),
      ),
    );
  }
  try {
    const project = location.pathname.replace(/^\/projects\/?/, "").replace(/\/$/, ""),
      scene = new URLSearchParams(location.search).get("scene");
    workspaces = await fetch("/api/workspaces", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { workspaces?: WorkspaceSummary[] }) => j.workspaces ?? [])
      .catch(() => []);
    if (project) detail(await call<ProjectDetail>("open", { project }));
    else if (scene) {
      try {
        const p = await call<ProjectDetail>("open", { scene });
        history.replaceState(null, "", url(p.id));
        detail(p);
      } catch (e) {
        if (!(e instanceof ProjectRequestError) || e.code !== "not_found") throw e;
        directory((await call<{ projects: ProjectSummary[] }>("list")).projects);
      }
    } else directory((await call<{ projects: ProjectSummary[] }>("list")).projects);
  } catch (e) {
    report(e instanceof Error ? e.message : String(e), true);
  }
}
