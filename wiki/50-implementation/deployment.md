---
title: Deployment
tldr: One command, bun run deploy, checks the project, builds the viewer, the model and the wiki into one static folder, copies it to the production server as a new dated release, switches the live site to it in one atomic step, checks the live pages over HTTPS and switches back if they fail. Nothing runs on the server but a static file server.
status: living
updated: 2026-11-23
tags: [deployment, implementation, wiki, viewer]
---

# Deployment

## TL;DR

- **`bun run deploy`** publishes the viewer at `mightwork.ai/rigtwin/` and this wiki at `mightwork.ai/rigtwin/wiki/` ([R-64](../10-request/requirements.md#r-64), [R-65](../10-request/requirements.md#r-65), [SF-25](../10-request/requirements.md#sf-25), decision [D-32](../20-decisions/decision-log.md#d-32)). Always run **`bun run deploy --dry-run`** first: it does every local step and prints the exact server commands without running them.
- It refuses to publish when `bun run check` fails, when `bun run wiki lint` finds an error, or when the git working tree has uncommitted changes. What goes live is therefore always a commit that passed every check.
- Each deployment is a **complete new folder** on the server; the live site is a symbolic link switched in one step. A failed check after the switch puts the link back automatically; **`bun run deploy --rollback`** goes back one release by hand.
- The distribution is about **17 MB in 129 files** (*measured* on 2026-11-23 with 29 wiki pages): viewer 0.74 MB, model 0.94 MB with its description, wiki 15.5 MB, almost all of it images. No file under `private/` or `work/` is ever copied, and every photograph in it is a masked copy.
- Continuous deployment from GitHub is **not set up**: it would mean storing a server credential in GitHub, which is the owner's decision.

The script is `tools/deploy.ts`, its settings `deploy.config.json`; how the viewer itself works is on the
[viewer page](viewer.md), the checks it runs are on the [checks page](../40-method/checks.md).

## What is published

`bun run dist` assembles one self-contained folder, `dist/`. All addresses inside it are relative, so it
works from any sub-path; it is tested from `/rigtwin/` on every build.

| Path in `dist/` | What | Size (*measured*, 2026-11-23) |
|---|---|---|
| `index.html`, `viewer.css`, `viewer.js` | the viewer, bundled with three.js; no other file is loaded from anywhere | 2 kB, 16 kB, 726 kB |
| `asset/rig-b.glb` | the model | 720 kB |
| `asset/rig-b.manifest.json` | the model's description: parts, joints, where every number comes from | 220 kB |
| `version.json` | build time, source revision, model hash and triangle count; shown in the viewer's More menu and the wiki's footer | under 1 kB |
| `wiki/` | this wiki as a static site: one HTML page per Markdown page, one stylesheet, one small search script, the images | 15.5 MB in 123 files, 29 pages |
| `deploy-receipt.json` | written after a deployment (or dry run): what was published, where, and the result of every check | — |

The wiki site has navigation by section, a table of contents per page, the TL;DR highlighted, a status
badge and the date of the last update, previous and next links, a search over titles and summaries,
light and dark themes, tables that scroll sideways on a phone, and a link back to the viewer. Every page
carries `noindex`, so search engines are asked not to list it.

Never in the distribution: anything under `private/` (photo originals, solved cameras, unmasked renders)
or `work/`. `bun run dist` compares every file it writes with every file under `private/` by size and
hash and fails on a match; `bun run check` scans every file outside `private/` and `work/` for banned
names. The photo comparisons in the wiki are made from the masked copies only (next section).

## Images for the wiki

**`bun run render --set wiki`** regenerates every model image the wiki uses, under names that never change,
so pages need no edit when the model changes (about 10 s, *measured*):

| Folder | Files |
|---|---|
| `wiki/img/model/` | `rig-b-contact-sheet.jpg` (five orthographic views and one perspective); `rig-b-parts-colour-coded.jpg` (one colour per part, with legend); `rig-b-group-<group>.jpg` for platform, seat, pods, stand, pedals; `rig-b-view-front-left.jpg`, `-rear-right.jpg`, `-operators-eye.jpg`, `-side.jpg` (1600 × 1000); `rig-b-joint-limits.jpg` (seat slide and recline, monitor height and tilt, joystick pitch and roll, armrest pad and a pedal, each at both ends of its travel) |
| `wiki/img/matched/` | per solved photo camera: `rig-<rig>-photo-<n>-side-by-side.jpg` (photo, model), `-outline.jpg` (model outlines on the photo), `-strip.jpg` (all three); `<rig>` is b, c1 or c2, the rig in the photo |

The photo comparisons use the **masked** photographs in `wiki/img/photos/` as the photo layer (the same
framing as the working copies, smaller: the camera's pixel numbers are scaled to fit). While they are made,
the local server has no route to `private/` at all except the camera file, which it answers already
re-pointed at the masked copies; the tool also stops if the page asks for any file it does not expect.
`bun run render --set matched --photos wiki/img/photos` makes the comparisons alone.

An image whose new picture is the same as the file already there (up to the noise of JPEG coding) is left
untouched, so running the set again on an unchanged model changes no committed file. Every image is a
JPEG under 400 kB.

## The deploy pipeline step by step

Settings, in `deploy.config.json` (committed):

```json
{
  "host": "samsinn",
  "remoteRoot": "/srv/rigtwin",
  "publicUrl": "https://mightwork.ai/rigtwin/",
  "keepReleases": 5
}
```

`host` is an SSH alias from the deploying person's `~/.ssh/config`; no address, user name or key is
stored in the repository.

1. **Refuse early** (all reasons are listed at once):
   - the git working tree must be clean; a folder that is not a git repository yet counts as not clean
     (override: `--allow-dirty`);
   - `bun run wiki lint` must report no error (override: `--allow-lint`);
   - `bun run check` must pass (no override).
2. **Build locally**, stopping at the first failure; nothing has touched the server yet:

   ```sh
   bun run build               # the model: 0.2 s
   bun run render --set wiki   # the wiki's images: 10 s (--no-images skips it)
   bun run wiki index          # the generated index: 0.01 s
   bun run wiki build          # the wiki site: 0.15 s
   bun run dist                # dist/, tested from /rigtwin/: 1.5 s
   ```

   If these steps changed a committed file (a regenerated image, the index), the site would not match
   the commit, and the deployment stops with the list of files: commit them and run it again.
3. **Upload** a new release folder named after the build time and the revision, for example
   `20261123T204500Z-3f2c1ab`:

   ```sh
   ssh samsinn 'mkdir -p /srv/rigtwin/releases'
   rsync -az --delete dist/ samsinn:/srv/rigtwin/releases/20261123T204500Z-3f2c1ab/
   ssh samsinn 'chmod -R u+rwX,go+rX,go-w /srv/rigtwin/releases/20261123T204500Z-3f2c1ab'
   ```

   A release folder that already exists is never overwritten.
4. **Switch** the live link in one step (the web server sees either the old or the new release, never a mix):

   ```sh
   ssh samsinn 'ln -sfn /srv/rigtwin/releases/20261123T204500Z-3f2c1ab /srv/rigtwin/current.tmp && mv -T /srv/rigtwin/current.tmp /srv/rigtwin/current'
   ```

5. **Check the live site over HTTPS**: the viewer page answers 200 with HTML; `version.json` is exactly
   the one just built; the model file has the same size and SHA-256 as the local one; the wiki's start page
   and two wiki pages answer 200. Each check is tried three times a second apart. If one fails, the link
   goes back to the previous release, that release is checked, and the command ends with an error; the
   failed release stays on the server to be looked at. Three more things are reported as warnings
   only: `/rigtwin` redirects to `/rigtwin/`, `/rigtwin/wiki` redirects to `/rigtwin/wiki/`, and the
   `X-Robots-Tag: noindex` header is sent.
6. **Tidy up** (only after the checks passed): release folders beyond the five newest are deleted, never
   the live one or the one before it.
7. **Report**: a summary on the screen and `dist/deploy-receipt.json` with the release, the previous
   release, the version, every remote command and every check.

`bun run deploy --dry-run` runs steps 1 and 2 for real and prints the commands of steps 3 to 6 without
running them. Measured on 2026-11-23 on the build machine (one Apple M2): a dry run takes about 17 s, of
which the documentation images take 10 s, `check` 4.5 s and `dist` with its browser test 1.5 s. The same
pipeline was run end to end against a stand-in server on the build machine (a local folder reached
through a substitute for `ssh`, and a local web server): three deployments, pruning to the newest
releases, `--rollback`, and an automatic switch back after a deliberately failed check all behaved as
described (*tested*). It has not yet run against the production server.

## Rolling back

```sh
bun run deploy --rollback --dry-run   # shows what it would do
bun run deploy --rollback             # live link to the release before the current one, then the same HTTPS checks
```

It does not build anything and does not delete anything. If the older release fails its checks, the link
returns to where it was. By hand, the same is one command (list the releases with
`ssh samsinn 'ls -1 /srv/rigtwin/releases'`):

```sh
ssh samsinn 'ln -sfn /srv/rigtwin/releases/<release> /srv/rigtwin/current.tmp && mv -T /srv/rigtwin/current.tmp /srv/rigtwin/current'
```

## What the server must provide

The deploy script never reads or changes the web server's configuration. It expects:

- an SSH login under the alias `samsinn` that works without a password prompt and may write in
  `/srv/rigtwin`; `rsync` and the GNU core utilities (for `mv -T`) on the server;
- a static file server that serves the folder `/srv/rigtwin/current` (following the link, looked up on
  every request) at the address path `/rigtwin/`, serves `index.html` for a folder, redirects a folder
  asked for without its trailing slash, and redirects `/rigtwin` to `/rigtwin/`;
- preferably the header `X-Robots-Tag: noindex` (every page also carries the same instruction as a meta tag).

The site block the coordinator installs on the production server (Caddy), inside the existing
`mightwork.ai` block:

```caddyfile
mightwork.ai {
	# … the site's existing routes stay as they are …

	redir /rigtwin /rigtwin/ 308

	handle_path /rigtwin/* {
		root * /srv/rigtwin/current
		header X-Robots-Tag "noindex, nofollow"
		file_server
	}
}
```

`handle_path` removes `/rigtwin` from the address before looking for the file, so
`/rigtwin/wiki/index.html` is read from `/srv/rigtwin/current/wiki/index.html`. Optional, and *not
verified* on the server: `header Cache-Control "no-cache"` inside the same block makes browsers ask
for a fresh copy after every deployment (they still get a quick "not modified" answer when nothing
changed), so a returning visitor can never combine a new page with an old script.

## Updating production after a change

After changing the model or the wiki:

1. Model: `bun run build` and `bun run check`; then `bun run render --set wiki` so the wiki's images
   show the new model (images that did not change are left as they were).
2. Wiki: `bun run wiki index` and `bun run wiki lint` until it reports no error.
3. Commit everything.
4. `bun run deploy --dry-run`, read what it prints, then `bun run deploy`.

Doing 1 to 3 before deploying means the deploy's own rebuild changes nothing and it does not stop to ask
for a commit. To publish a wiki fix without regenerating the images, add `--no-images`.

## Continuous deployment from GitHub (not set up)

Publishing automatically on every push to GitHub would need:

- **A server credential for GitHub**: a new SSH key used only for deployment, stored as an encrypted
  secret of the repository, and on the server a separate user (not `root`) that may write only in
  `/srv/rigtwin/releases` and replace the link `/srv/rigtwin/current`; ideally the key is limited further
  on the server (a forced command or rsync's restricted mode, and the runners' addresses).
- **A GitHub Actions workflow** that, on a push to the main branch, installs Bun and the pinned
  dependencies (`bun install --frozen-lockfile`), installs the headless Chromium the checks need, and
  runs the same `bun run deploy`. The checks and the refusal rules stay exactly as they are locally.
- **The photo cameras**: the projection self-test in `bun run check` and the photo comparisons need
  files under `private/`, which never enter the repository. A workflow would either skip those two
  (deploying with `--no-images` and committed images) or receive the cameras as another secret.

It was left as **the owner's decision** ([D-32](../20-decisions/decision-log.md#d-32)), because it means
storing a key to the production server in GitHub; no credential is created unasked. Until then a person
runs `bun run deploy` from a working copy.

## Production state

> **Placeholder, to be filled in by the coordinator after the first deployment.** Until then nothing in
> this section has been verified.

| Item | Value |
|---|---|
| First deployment (date, release folder) | *to be filled in* |
| Live release and version line | *to be filled in* |
| Web server and the site block as installed | *to be filled in* |
| Result of the HTTPS checks (from `dist/deploy-receipt.json`) | *to be filled in* |
| Warnings (redirects, `X-Robots-Tag`) | *to be filled in* |
| Time of a full deployment, measured | *to be filled in* |
