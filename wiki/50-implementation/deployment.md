---
title: Deployment
tldr: Every push to main deploys automatically through GitHub Actions; the same script, bun run deploy, can be run by hand. It checks the project, builds the viewer, the model and the wiki into one static folder, uploads it as a new dated release through a restricted server account, switches the live site in one atomic step, checks the live pages over HTTPS and switches back if they fail.
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
- **Every push to `main` deploys automatically** (GitHub Actions, [workflow](#continuous-deployment-from-github)). The key GitHub holds can log in only as the unprivileged account `rigtwin-deploy` and run only the deploy script's own commands inside `/srv/rigtwin`; the owner approved this on 2026-11-23.

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
  "host": "rigtwin-deploy",
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
   ssh rigtwin-deploy 'mkdir -p /srv/rigtwin/releases'
   rsync -az --delete dist/ rigtwin-deploy:/srv/rigtwin/releases/20261123T204500Z-3f2c1ab/
   ssh rigtwin-deploy 'chmod -R u+rwX,go+rX,go-w /srv/rigtwin/releases/20261123T204500Z-3f2c1ab'
   ```

   A release folder that already exists is never overwritten.
4. **Switch** the live link in one step (the web server sees either the old or the new release, never a mix):

   ```sh
   ssh rigtwin-deploy 'ln -sfn /srv/rigtwin/releases/20261123T204500Z-3f2c1ab /srv/rigtwin/current.tmp && mv -T /srv/rigtwin/current.tmp /srv/rigtwin/current'
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
`ssh rigtwin-deploy 'ls -1 /srv/rigtwin/releases'`):

```sh
ssh rigtwin-deploy 'ln -sfn /srv/rigtwin/releases/<release> /srv/rigtwin/current.tmp && mv -T /srv/rigtwin/current.tmp /srv/rigtwin/current'
```

## What the server must provide

The deploy script never reads or changes the web server's configuration. It expects:

- an SSH alias `rigtwin-deploy` (the `host` in `deploy.config.json`) that logs in as the unprivileged
  account `rigtwin-deploy`, which owns `/srv/rigtwin`; `rsync` and the GNU core utilities (for
  `mv -T`) on the server. Locally the alias is in `~/.ssh/config`; in GitHub Actions the workflow
  writes it;
- on the server, the gate `/usr/local/bin/rigtwin-deploy-gate` (source: `deploy/rigtwin-deploy-gate.sh`)
  as the forced command of every key of that account (next section);
- a static file server that serves the folder `/srv/rigtwin/current` (following the link, looked up on
  every request) at the address path `/rigtwin/`, serves `index.html` for a folder, redirects a folder
  asked for without its trailing slash, and redirects `/rigtwin` to `/rigtwin/`;
- preferably the header `X-Robots-Tag: noindex` (every page also carries the same instruction as a meta tag).

The site block installed on the production server is `deploy/mightwork-apex.caddy` in this repository
(Caddy; one file per site under `/etc/caddy/managed-sites/`). It serves only the bare domain
`mightwork.ai`: `/rigtwin` redirects to `/rigtwin/`, `/rigtwin/*` comes from `/srv/rigtwin/current`
with `X-Robots-Tag: noindex` and `Cache-Control: no-cache` on pages and data, and every other address
returns 404.

`handle_path` removes `/rigtwin` from the address before looking for the file, so
`/rigtwin/wiki/index.html` is read from `/srv/rigtwin/current/wiki/index.html`.

### The restricted deploy account

Set up on 2026-11-23 after the owner chose automatic deployment.

| Part | What it is |
|---|---|
| Account | `rigtwin-deploy`, a system user with no password and no sudo; owns `/srv/rigtwin` and nothing else |
| Keys | `/var/lib/rigtwin-deploy/.ssh/authorized_keys`, owned by root so the account cannot add keys; two keys, the GitHub Actions key and the owner's own key for manual deploys, both with `restrict,command="/usr/local/bin/rigtwin-deploy-gate"`: no shell, no terminal, no port or agent forwarding |
| Gate | `deploy/rigtwin-deploy-gate.sh`, installed as `/usr/local/bin/rigtwin-deploy-gate`. It compares the requested command with nine anchored patterns, one per command the deploy script sends (make the release folder, read the live link, list releases, test for a release, upload with rsync, set permissions and confirm two files, switch the link, read a release's `version.json`, delete old releases), all confined to `/srv/rigtwin`. Anything else is refused with exit code 126 |
| No links | after every upload the gate deletes symbolic links in that release, and it refuses to switch to a release that contains one, because the web server would follow a link to any readable file on the host |
| Log | every allowed and refused command goes to the system log with the tag `rigtwin-deploy-gate` (`journalctl -t rigtwin-deploy-gate`) |
| Host key | the server's host key is pinned in `deploy/known_hosts` (checked against the key already trusted for the server's address); the workflow refuses any other |
| Tested | allowed: every deploy command, both the GNU rsync form (GitHub runner) and the macOS openrsync form; refused: `id`, `cat /etc/passwd`, an interactive login, port forwarding, and in a local pattern test 12 injection and escape attempts (extra commands after `;` or `&&`, `$(…)`, paths outside `/srv/rigtwin`, `..`, links to `/etc`) |

To revoke GitHub's access: delete the first line of the server's `authorized_keys` (or the repository
secret `DEPLOY_SSH_KEY`). To change what the deploy may do, change `tools/deploy.ts` and the gate together.

## Updating production after a change

After changing the model or the wiki:

1. Model: `bun run build` and `bun run check`; then `bun run render --set wiki` so the wiki's images
   show the new model (images that did not change are left as they were).
2. Wiki: `bun run wiki index` and `bun run wiki lint` until it reports no error.
3. Commit everything and push to `main`: GitHub Actions deploys it.
4. Or by hand: `bun run deploy --dry-run`, read what it prints, then `bun run deploy`.

Doing 1 to 3 before deploying means the deploy's own rebuild changes nothing and it does not stop to ask
for a commit. To publish a wiki fix without regenerating the images, add `--no-images`.

## Continuous deployment from GitHub

Set up on 2026-11-23 at the owner's request; workflow `.github/workflows/deploy.yml`.

1. **Trigger**: every push to `main`, or by hand from the repository's Actions tab. Runs never overlap
   (one deploy at a time) and a run that is already deploying is never cancelled.
2. **Runner**: GitHub's Ubuntu 24.04 machine; Bun 1.4.0; `bun install --frozen-lockfile`; Google Chrome
   from the runner image for the headless checks, with WebGL in software (SwiftShader).
3. **Key**: the repository secret `DEPLOY_SSH_KEY` is written to a file for the run and deleted at the
   end; the SSH settings pin the server's host key from `deploy/known_hosts`.
4. **Deploy**: `bun run deploy --no-images`, the same script and the same refusal rules as a manual
   deploy: every check, wiki lint, clean commit, build, wiki site, distribution with its own browser
   check, upload, switch, nine live checks, automatic switch-back on failure.
5. **Receipt**: `dist/deploy-receipt.json` is kept as a run artifact.

What the runner cannot do, and how it is handled:

- **No private files.** The photo cameras and the photographs never enter the repository. The
  projection self-test then uses its two synthetic cameras only, and the photo-comparison images are
  not regenerated (`--no-images`): the committed images are published. After changing the model,
  regenerate the images locally (`bun run render --set wiki`) and commit them, or they will show the
  old model.
- **No GPU.** The frame-rate check runs in software rendering and reports a warning, not a failure,
  below 55 frames per second; the real figure is the one measured on a development machine.

A manual deploy from a working copy (`bun run deploy`) still works and goes through the same restricted
account and gate (*tested* on 2026-11-23: release `20261123T222830Z-ac78fc6`, 14.8 s, every server
command allowed by the gate, including the macOS rsync form).

The model file built on the runner is not byte-identical to one built on macOS (floating-point functions
differ slightly between platforms; each platform is deterministic on its own), so the live model's
SHA-256 is the runner's. The live check compares against the file that was uploaded.

**First runs.** The first run (commit `ac78fc6`) refused to deploy because a check failed on the runner
([F-32](../60-lessons/failures-and-fixes.md#f-32)); nothing was uploaded. The fix followed in the next
commit.

## Production state

Verified by the coordinator on 2026-11-23 after the first deployment.

| Item | Value |
|---|---|
| Addresses | viewer <https://mightwork.ai/rigtwin/>, wiki <https://mightwork.ai/rigtwin/wiki/> |
| Server | the production host, reached through the restricted alias `rigtwin-deploy` (see above); Caddy 2.11.4 serving ports 80 and 443 for several sites |
| Site block as installed | `deploy/mightwork-apex.caddy` in this repository, copied to `/etc/caddy/managed-sites/mightwork-apex.caddy` (the main Caddyfile imports that folder). It serves only the bare domain `mightwork.ai`: `/rigtwin` redirects to `/rigtwin/`, `/rigtwin/*` is served from `/srv/rigtwin/current`, anything else returns 404; `X-Robots-Tag: noindex`. The full configuration was validated with `caddy validate` before `systemctl reload caddy`; a Let's Encrypt certificate for `mightwork.ai` was obtained automatically within seconds |
| Other sites on the host | checked before and after the change: every one answered with the same status as before (303, 303, 200, 302, 200) |
| First deployment | 2026-11-23 21:21 UTC, release `20261123T212137Z-5d673d1`, version line `2026-11-23 21:21 UTC · 5d673d1 · model 0b6d8248` |
| HTTPS checks | all nine passed: viewer page, `version.json` identical to the build, model file size and SHA-256, wiki start page and two wiki pages, `/rigtwin` and `/rigtwin/wiki` redirects, `X-Robots-Tag` |
| Not served (checked) | `private/…`, `work/`, parameter sources, `.git/config`, Markdown sources: all 404. The release folder contains only `index.html`, `viewer.js`, `viewer.css`, `version.json`, `asset/` and `wiki/` (21 MB) |
| Time of a full deployment | 24.8 s including check, build, documentation images, wiki build, distribution with its own browser verification, upload and live checks; a dry run takes about 17 s |
| Release history | see `ssh <host> 'ls -1 /srv/rigtwin/releases'`; the deploy keeps the newest 5 |
| Coordinator's browser check of the live site | viewer loads the model with no console errors (narrow layout in a small window); wiki index and gallery render; navigation and viewer link work |

### Updating production

After a change to the model, the viewer or the wiki: commit, push, then `bun run deploy`. The script
refuses to deploy an uncommitted or failing tree, builds everything from the commit, uploads a new
release folder, switches `current` only after the upload, checks the live site and switches back
automatically if a check fails. `bun run deploy --rollback` returns to the previous release.
