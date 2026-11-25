---
title: The Synergon server and its host setup
tldr: The server on the production host - one hardened Bun service on 127.0.0.1:4191 behind one Caddy site for synergon.mightwork.ai, installed once by a reviewed setup script with fourteen host checks. The setup for the new address is prepared and tested locally; it has not been run on the host yet.
status: living
updated: 2026-11-25
tags: [deployment, server, host, security, platform]
---

# The Synergon server and its host setup

## TL;DR

- **One service**, `synergon-server`: the bundled server of the live release, run by Bun 1.4.0 as its own user on `127.0.0.1:4191`, with no network but loopback, one CPU core and 512 MB, and a view of the file system that holds only Synergon's own folders.
- **One Caddy site**, `synergon.mightwork.ai`: `/api/*` goes to the service, `/server/*` answers 404 (so the server's code is in the release but never served, [D-42](../20-decisions/decision-log.md#d-42)), `/workspaces/*` gives the viewer page, everything else is the static release (viewer at `/`, wiki at `/wiki/`). The bare domain `mightwork.ai` has no route left: it answers 404.
- **One setup script**, `deploy/setup-server.sh` (`--check`, `--apply`, `--probe`, `--undo`, `--retire-apex`, `--restore-apex`), run as root on the host only with the owner's yes; it puts the previous Caddy state back on any failure and compares every other site before and after. `deploy/HOST-CHECKS.md` lists the fourteen host checks.
- **Status on 2026-11-25: prepared, not run.** The script's 103 local test cases pass; nothing on the host has changed. The host checks H7 and H14 passed for the earlier layout (2026-11-24: the same unit, the same server code); they are repeated for the new one ([order and status](#order-of-the-first-rollout)).
- How a release is built, uploaded and switched is on the [deployment page](deployment.md).

The server holds the shared scenes of the public workspaces (a scene is the rig's pose, the person and its last
200 changes; [the platform plan](../30-plan/platform-plan.md)) and answers the commands and the live channel the viewer
and `bun run rig` use. The same code runs on the laptop (`bun run serve`); how the viewer uses it is on the
[viewer page](viewer.md). The commands go over plain HTTP POST and the changes come back as server-sent events, not a
WebSocket ([D-39](../20-decisions/decision-log.md#d-39)).

## The service

`deploy/synergon-server.service`, installed as `/etc/systemd/system/synergon-server.service`:

| Setting | Value |
|---|---|
| Program | `/opt/synergon/runtime/bun /srv/synergon/current/server/server.js --mode deployed --port 4191 --host 127.0.0.1 --data /var/lib/synergon`: the bundled server of the live release, run by Bun 1.4.0 |
| Address | **127.0.0.1:4191**, loopback only. 4180 is used by another service on the host and 4190 by the earlier layout's service, which runs until the cutover is finished, so this one has its own port ([D-45](../20-decisions/decision-log.md#d-45)) |
| User and data | system user `synergon` (no login, no home); data in `/var/lib/synergon` (mode 0700): one folder per workspace with its `doc.json` (written atomically, at most four times a second), and `secret` (the key for the author ids) |
| Restarts | `Restart=always`, every 2 s, no start limit: until the first release with `server/` is live each start fails and is tried again, so that release starts it within seconds. The server exits by itself when `current` points at another release, and systemd starts it from the new one |
| Files | the whole file system read-only (`ProtectSystem=strict`). One rule that names nothing keeps whatever else the host runs out of reach (after host check H10): each of `/srv`, `/opt` and `/var/lib` is replaced by an empty read-only folder holding only synergon's own part (the releases, the runtime, and the data folder, the one writable place). Also hidden: `/etc/caddy`, `/var/www`, `/var/backups`, home folders; private `/tmp` and devices. Other programs' settings under `/etc` are not named in the unit: their own file permissions guard them (the service is an unprivileged user without capabilities) |
| Privileges | no new privileges, no capabilities, system calls limited to `@system-service` (a blocked call fails instead of killing the process), kernel settings, modules, logs, clock and control groups protected |
| Network | none but loopback (`IPAddressDeny=any`, `IPAddressAllow=localhost`): Caddy connects to it, it connects to nothing |
| Resources | one CPU core (`CPUQuota=100%`), 512 MB of memory, 128 tasks, 4,096 open files, a low disk share; journal lines limited to 200 per 30 s |

*Not verified locally* (macOS has no systemd): the setup script runs `systemd-analyze verify` before it
installs the unit, and `--probe` runs Bun once under every setting of the unit (host check H7): it must
serve on loopback, list only `synergon` in `/srv`, `/opt` and `/var/lib`, write its data folder, and fail to
reach the internet.

## The Caddy route

`deploy/synergon.caddy` is the site block for `synergon.mightwork.ai`, in this order (Caddy tries the block with the
longest path first; each block's matcher is one inline path on purpose, since a named matcher would be sorted after
the shorter ones). The headers are the same on every answer: HSTS, `X-Content-Type-Options: nosniff`, no referrer,
`X-Robots-Tag: noindex, nofollow`, no `Server` header.

| Address | Answer |
|---|---|
| `/server/*` | 404: the server's code is in the release folder but never served |
| `/api/*` | passed to `127.0.0.1:4191` unchanged (the server sees `/api/…`, also `/api/workspaces/<id>/…`); request bodies at most 64 KiB, as the server's own limit. No `flush_interval -1`: Caddy passes event streams on at once anyway, and with that setting it would keep the request to the server open after the visitor has gone |
| `/workspaces/*` | the viewer page (`index.html`) of the release: the address of a workspace is a page of the viewer; `no-cache` |
| everything else | the static release from `/srv/synergon/current`: the viewer at `/`, the wiki at `/wiki/`; compression (`encode`) only on the static answers, so it cannot hold back live events; `Cache-Control: no-cache` on pages (`.html` and folders) and data (`.glb`, `.json`) so that a deploy shows at once; the person's `.ktx2`, `.bin` and `.wasm` carry no such header and may be cached, since their addresses carry the release's revision; `file_server { hide /srv/synergon/current/server }` as a second guard (it also covers `/server` without the slash) |

HTTPS is automatic: Caddy obtains and renews the certificate for the host name (it must resolve to the host, and ports
80 and 443 must be reachable). The bare domain has its own file, `deploy/mightwork-apex.caddy`: the same headers and one
rule, `respond "Not found" 404` for every address, so a visitor to `mightwork.ai` gets a clean 404 over HTTPS and no
route is left. (Removing that file instead would leave the name without any site, and Caddy would then not answer it
at all.)

Caddy passes the visitor's address in `X-Forwarded-For`; the server believes that header only from
loopback. *Not validated locally* (no Caddy on the laptop): the setup script validates the file on its own
and then the whole configuration on the host before it reloads Caddy.

## The setup script and the host checks

`deploy/setup-server.sh` is run once, as root on the production host, only with the owner's yes, inside
`tmux` (or `systemd-run --scope`) so that a dropped connection cannot stop it half-way:

| Mode | What it does |
|---|---|
| `--check` | changes nothing: prints the status of every Caddy site and service, the host checks, and what `--apply` would do |
| `--apply` | in this order: the system user `synergon` and `/var/lib/synergon`; the **deploy account** `synergon-deploy` (no password, a shell for the forced command), its keys from a file of public keys next to the script (each written as `restrict,command="/usr/local/bin/synergon-deploy-gate"`, in a folder owned by root so the account cannot add keys), the gate `/usr/local/bin/synergon-deploy-gate` and the folder `/srv/synergon`; Bun 1.4.0 into `/opt/synergon/runtime/` from the official release zip for the host's architecture, checked against a pinned SHA-256 before anything is installed; the Caddy site file `synergon.caddy` under the host's Caddy lock (validated on its own, installed, the whole configuration validated, `systemctl reload caddy`; once the certificate is there `/` must answer 200 or, before the first release, 404, `/server/server.js` 404, `/api/health` must reach the route, and every other site must answer as before); then the unit (checked, installed, enabled, started). On any failure, a hang-up, Ctrl-C or a closed output, the new file is removed again and Caddy reloaded. A second run changes nothing |
| `--probe` | after `--apply`, and again after every change of the unit: runs Bun once under the unit's settings (host check H7) |
| `--undo [--purge-data]` | removes the service, the site file, the gate, the deploy keys and the runtime; the data folder, the releases and the two users stay unless `--purge-data` is given; refused as a whole while the live release contains `server/` (removing the 404 rule would then publish `server.js`) |
| `--retire-apex` | after the first deploy: installs `deploy/mightwork-apex.caddy`, so that `mightwork.ai` answers 404 for every address. Refused unless `https://synergon.mightwork.ai/` and `/api/health` answer 200. A timestamped backup, the file from before kept as `mightwork-apex.caddy.before-retire`; mightwork.ai must answer 404 at three addresses and every other site as before, or the file is put back |
| `--restore-apex` | puts the file from before `--retire-apex` back |

Every run appends to `/var/log/synergon-setup.log` and the system log (`journalctl -t synergon-setup`).
Every Caddy reload closes the streaming connections of every site on the host for a moment; the sites
themselves stay up. The script is tested locally against a stand-in host (103 cases, in `bun run check`).

`deploy/HOST-CHECKS.md` lists the fourteen checks on the host (H1 to H14), each with when to run it and
what to expect: Caddy's reload path and lock, the apex file's hash, the host reaching its own sites,
no proxy in front, systemd and kernel versions, Bun under the unit's hardening (H7), exposure and limits
after the first server release (H8), journal room, other applications' files (H10, which led to the
rule for `/opt` and `/var/lib` above), disk and access logs, nothing of `server/` served (H12), the tools the
script needs, and many slow live streams (H14).

## Host check H14: live streams that do not read

`tools/deploy-tests/stream-load.ts` runs the built server in deployed mode on a throwaway port, asks for
300 live streams that never read (6 per visitor, one visitor per network block) and sends 50 full-pose
edits a second for 60 s. It prints the server's memory, CPU and health time every 5 s and, on Linux, the
kernel's TCP memory against its pressure threshold; at the end it reads every stream out.

| Run (2026-11-24, on the host) | Result |
|---|---|
| First: the bundle with 300 streams and no byte budget | **failed.** The server stayed healthy (peak 77 MB, health in 0–1 ms, about 10 % CPU), but the kernel's TCP memory reached 59,172 pages against a pressure threshold of 58,837: Linux took about 770 kB per non-reading stream into socket buffers, so the server's own 1 MB queue limit never triggered ("0 of 300 slow streams closed") |
| Fix | a byte budget per stream: a stream that has been given 512 kB in all, read or not, is ended after its last event (an `end` event, on which the page reconnects at once); the browser asks for the changes after the last version it saw and gets only those. The ended stream's place in the limits stays taken until its connection is gone (at most 45 s), so reconnecting cannot multiply the buffers. And 150 streams in all (was 300), 12 per network block (was 30). Worst case about 150 × 0.5 MB = 75 MB of socket memory ([D-46](../20-decisions/decision-log.md#d-46)) |
| Second: the bundle with the fix (SHA-256 `270ec3ab…`; the `end` event was added after this run) | **passed.** 150 of 150 taken streams ended by the server, largest 527,904 bytes, server peak 66 MB, health 0–1 ms throughout, TCP memory peak 28,698 pages (49 % of the pressure threshold), the host's other sites unaffected |

On the laptop the fixed server also passes a 30 s run (150 of 300 taken, all ended, largest 528,124
bytes); before the fix, macOS's own network memory ran out with 300 stalled loopback connections.

## Guards on the open server

Built in deployed mode only; a local server has none. The numbers are in `server/limits.ts`
(the plan's D1 table, with the changes from the security review and H14):

| Guard | Number |
|---|---|
| Request body | 64 KiB (Caddy and the server); it must arrive within 10 s |
| Live streams | 6 per visitor, 12 per network block (IPv6 /48, IPv4 /24), 150 in all; a heartbeat every 15 s; a stream is closed when 1 MB is queued for it, and ended after 512 kB in all |
| Edits | 60 a minute per visitor, 10 a second per network block, 50 a second in all (view commands count as edits) |
| Queries | 600 a minute per visitor (every other request under `api/`) |
| Session codes | eight characters; after five unknown codes a minute a visitor's view commands are refused |
| Disk | writes refused when the data disk has less than 5 % or 200 MB free |
| MCP (since agent interface v2) | `POST api/mcp`: tool calls go through the same guards as commands (edits count as edits, queries as queries); every MCP request counts as a query; one JSON-RPC message per request (batches refused); a content type of exactly `application/json`; an `Origin` other than the server's own (`https://mightwork.ai`, locally `http://<Host>`) refused; a viewer code kept for the session only when it is one; at most 500 MCP sessions remembered ([D-50](../20-decisions/decision-log.md#d-50)) |
| Pictures (since agent interface v2) | `POST api/picture`: only for a picture being waited for (a random 128-bit id sent only with the view event), only from the page that was asked, once, a JPEG of at most 60 kB (within Caddy's 64 KiB); `look` waits at most 8 s; at most 20 pictures waited for at once, 2 per visitor and 1 per browser ([D-51](../20-decisions/decision-log.md#d-51)) |
| Consent (since agent interface v2) | a view for no named browser, from an agent no browser follows, is put to every open page as a question: at most 4 a minute per agent, in the server's words; a picture with it waits up to 25 s for the answer ([D-55](../20-decisions/decision-log.md#d-55)) |
| Follow (since agent interface v2) | `POST api/follow`: a page follows one caller's views; counts as an edit; at most 10 pages per caller; a picture answered by a following page is marked unverified ([D-54](../20-decisions/decision-log.md#d-54)) |
| Trace (since agent interface v2) | one record per request, in memory only (the last 100, `GET api/trace`, the live event `trace`); at most 8 sent a second; no text a caller wrote: arguments as ids, numbers and the model's own words, the rest as ‹text›, refusals by code and hint ([D-53](../20-decisions/decision-log.md#d-53)) |
| Request names | a name ending in `-<number>` is made by the server (intent commands) and refused from callers; `state` shows only those, so a name a stranger chose never reaches an agent's context as text |
| Visitor | the address from `X-Forwarded-For`, believed only from loopback (IPv6 by its /64 block) |
| Errors | `development: false`: no error page with code (a check in `bun run check` keeps it so) |
| What is stored | the Playground's pose and its last 200 changes, each with a random author id made by the server; the only text written by a client is a request's group name ([D-41](../20-decisions/decision-log.md#d-41)). The page says so under More → "About this sandbox" |

## Order of the first rollout

The deploy's checks need the host's route before the first release that contains `server/`; otherwise
every automatic deploy would stop at the route probe. So, on the host and on the laptop (the owner approves the
commands as one batch; the command list with what each does and how to undo it is the owner's cutover runbook, kept
outside the repository):

1. `setup-server.sh --check` on the host; read every line (H1–H6, H9–H11, H13); the owner says yes.
2. `setup-server.sh --apply` inside tmux: the users, the gate and the folders, Bun, the Caddy site and its 404 rule,
   then the service, which retries every 2 s until a release with `server/` is live.
3. `setup-server.sh --probe` (H7) and the load test H14.
4. The first release: `bun run deploy` from the laptop (its route probe, upload, switch and live checks). The service
   starts from the release and `api/health` must report the new revision within 20 s. The stored scene of the earlier
   address is copied into `/var/lib/synergon` and migrated once, by a one-off script outside the repository.
5. `setup-server.sh --check` again (H8, H12); on the laptop `bun tools/live-idle-test.ts --url
   https://synergon.mightwork.ai` (ten minutes idle through Caddy, then one change and its undo in the public
   Playground workspace); then the two-browser test, `bun tools/live-site-check.ts https://synergon.mightwork.ai`.
6. `setup-server.sh --retire-apex`: `mightwork.ai` answers 404 for every address. Then the earlier address's service,
   account, gate and folders are removed (after an archive of the old data is copied to the owner's laptop), the
   repository is renamed on GitHub and the GitHub secret is moved to `SYNERGON_DEPLOY_SSH_KEY`.

**Status on 2026-11-25: steps 1 to 6 are prepared and not run.** The setup script, the two Caddy files, the unit, the
gate and the workflow are in the repository; the script's 103 local test cases (a stand-in host, in `bun run check`)
cover the setup, its repeat, the check, the undo, the retirement of the bare domain and its reversal, a failed
validation, a failed reload, another site answering differently, a wrong download checksum, a dropped session, a bad
key file, and the probe; `bun run deploy --dry-run` prints the new commands and addresses. Nothing has been run on the
host.

## What the first host setup taught (2026-11-24, earlier layout)

The same unit, server code and script design ran once on the host under the project's earlier name, with the owner's
yes. What carries over:

| Finding | Consequence now |
|---|---|
| `--check` stopped on port 4180, used by another site's server | the service has its own port, 4191 ([D-45](../20-decisions/decision-log.md#d-45)); the earlier layout's service is on 4190 until the cutover removes it |
| Caddy reloads with `--force` and does not watch files; only the setup script takes the Caddy lock; no proxy in front; systemd 255, kernel 6.8, 2 cores | the checks H1–H6 are still read on the host before `--apply` |
| H10 found one other site's files under `/opt` | the unit hides `/srv`, `/opt` and `/var/lib` whole except its own folders, and the probe checks all three |
| H14 failed once on the kernel's TCP memory and passed with the stream byte budget | the budget is in the server's limits; H14 is run again for the new service ([above](#host-check-h14-live-streams-that-do-not-read)) |
| the first push to `main` was refused by the deploy's own check on the runner, before any upload (new tests ran before the build; the setup script's test used two commands in their macOS form) | the setup test avoids `stat -f` and `sed -i ''`, and runs on both systems |
| the unit's exposure score was 1.4 with its limits in effect (H8); `server/server.js` answered 404 in seven spellings (H12) | the same two checks after the first release |
