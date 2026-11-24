---
title: The rigtwin server and its host setup
tldr: Platform step 1's server on the production host - one hardened Bun service on 127.0.0.1:4190 behind one Caddy route, installed once by a reviewed setup script with fourteen host checks. The setup ran on 2026-11-24 with the owner's yes, and the server has been live since the release of that evening.
status: living
updated: 2026-11-24
tags: [deployment, server, host, security, platform]
---

# The rigtwin server and its host setup

## TL;DR

- **One service**, `rigtwin-server`: the bundled server of the live release, run by Bun 1.4.0 as its own user on `127.0.0.1:4190`, with no network but loopback, one CPU core and 512 MB, and a view of the file system that holds only rigtwin's own folders.
- **One Caddy route**: `/rigtwin/api/*` goes to the service; `/rigtwin/server/*` answers 404, so the server's code is in the release but never served ([D-42](../20-decisions/decision-log.md#d-42)).
- **One setup script**, `deploy/setup-server.sh` (`--check`, `--apply`, `--probe`, `--undo`), run as root on the host only with the owner's yes; it restores the old Caddy file on any failure and compares every other site before and after. `deploy/HOST-CHECKS.md` lists the fourteen host checks.
- **Done on 2026-11-24:** the check, the setup, the probe and the load test H14 (failed once, passed after a fix: each live stream ends after 512 kB, 150 streams in all, [D-46](../20-decisions/decision-log.md#d-46)); then the merge to `main`, the first release with the server (commit `ff90f30`), the checks on the host after it, and the two-browser check on the live site ([order and status](#order-of-the-first-rollout)).
- How a release is built, uploaded and switched is on the [deployment page](deployment.md).

New in platform step 1 ([the platform plan](../30-plan/platform-plan.md)). The server holds the shared
scene of the public sandbox (the "Playground": the rig's pose and its last 200 changes) and answers the
commands and the live channel the viewer and `bun run rig` use. The same code runs on the laptop
(`bun run serve`); how the viewer uses it is on the [viewer page](viewer.md). The commands go over plain
HTTP POST and the changes come back as server-sent events, not a WebSocket ([D-39](../20-decisions/decision-log.md#d-39)).

## The service

`deploy/rigtwin-server.service`, installed as `/etc/systemd/system/rigtwin-server.service`:

| Setting | Value |
|---|---|
| Program | `/opt/rigtwin/runtime/bun /srv/rigtwin/current/server/server.js --mode deployed --port 4190 --host 127.0.0.1 --data /var/lib/rigtwin`: the bundled server of the live release, run by Bun 1.4.0 |
| Address | **127.0.0.1:4190**, loopback only. The design said 4180; the setup's read-only check on the host found 4180 already used by another service, so it moved to 4190 ([D-45](../20-decisions/decision-log.md#d-45)) |
| User and data | system user `rigtwin` (no login, no home); data in `/var/lib/rigtwin` (mode 0700): `playground/doc.json` (written atomically, at most four times a second) and `secret` (the key for the author ids) |
| Restarts | `Restart=always`, every 2 s, no start limit: until the first release with `server/` is live each start fails and is tried again, so that release starts it within seconds. The server exits by itself when `current` points at another release, and systemd starts it from the new one |
| Files | the whole file system read-only (`ProtectSystem=strict`). One rule that names nothing keeps whatever else the host runs out of reach (after host check H10): each of `/srv`, `/opt` and `/var/lib` is replaced by an empty read-only folder holding only rigtwin's own part (the releases, the runtime, and the data folder, the one writable place). Also hidden: `/etc/caddy`, `/var/www`, `/var/backups`, home folders; private `/tmp` and devices. Other programs' settings under `/etc` are not named in the unit: their own file permissions guard them (the service is an unprivileged user without capabilities) |
| Privileges | no new privileges, no capabilities, system calls limited to `@system-service` (a blocked call fails instead of killing the process), kernel settings, modules, logs, clock and control groups protected |
| Network | none but loopback (`IPAddressDeny=any`, `IPAddressAllow=localhost`): Caddy connects to it, it connects to nothing |
| Resources | one CPU core (`CPUQuota=100%`), 512 MB of memory, 128 tasks, 4,096 open files, a low disk share; journal lines limited to 200 per 30 s |

*Not verified locally* (macOS has no systemd): the setup script runs `systemd-analyze verify` before it
installs the unit, and `--probe` runs Bun once under every setting of the unit (host check H7): it must
serve on loopback, list only `rigtwin` in `/srv`, `/opt` and `/var/lib`, write its data folder, and fail to
reach the internet.

## The Caddy route

`deploy/mightwork-apex.caddy`, in this order (Caddy tries the block with the longest path first; each
block's matcher is one inline path on purpose, since a named matcher would be sorted after `/rigtwin/*`):

| Address | Answer |
|---|---|
| `/rigtwin/server/*` | 404: the server's code is in the release folder but never served |
| `/rigtwin/api/*` | passed to `127.0.0.1:4190` with `/rigtwin` removed (the server sees `/api/…`); request bodies at most 64 KiB, as the server's own limit. No `flush_interval -1`: Caddy passes event streams on at once anyway, and with that setting it would keep the request to the server open after the visitor has gone |
| `/rigtwin/*` | the static release as before; compression (`encode`) only here, so it cannot hold back live events; `file_server { hide /srv/rigtwin/current/server }` as a second guard (it also covers `/rigtwin/server` without the slash) |
| anything else on `mightwork.ai` | 404 |

Caddy passes the visitor's address in `X-Forwarded-For`; the server believes that header only from
loopback. *Not validated locally* (no Caddy on the laptop): the setup script validates the file on its own
and then the whole configuration on the host before it reloads Caddy.

## The setup script and the host checks

`deploy/setup-server.sh` is run once, as root on the production host, only with the owner's yes, inside
`tmux` (or `systemd-run --scope`) so that a dropped connection cannot stop it half-way:

| Mode | What it does |
|---|---|
| `--check` | changes nothing: prints the status of every Caddy site and service, the host checks, and what `--apply` would do |
| `--apply` | in this order: the system user and `/var/lib/rigtwin`; Bun 1.4.0 into `/opt/rigtwin/runtime/` from the official release zip for the host's architecture, checked against a pinned SHA-256 before anything is installed; the Caddy site file under the host's Caddy lock (validated on its own, a timestamped backup, installed, the whole configuration validated, `systemctl reload caddy`, then `/rigtwin/` must answer 200, `/rigtwin/server/server.js` 404, `/rigtwin/api/health` must reach the new route, and every other site must answer as before); then the unit (checked, installed, enabled, started). On any failure, a hang-up, Ctrl-C or a closed output, the backup is put back and Caddy reloaded. A second run changes nothing |
| `--probe` | after `--apply`, and again after every change of the unit: runs Bun once under the unit's settings (host check H7) |
| `--undo [--purge-data]` | removes the service, the route and the runtime and restores the site file from before the setup; refused as a whole while the live release contains `server/` (removing the 404 rule would then publish `server.js`) |

Every run appends to `/var/log/rigtwin-setup.log` and the system log (`journalctl -t rigtwin-setup`).
Every Caddy reload closes the streaming connections of every site on the host for a moment; the sites
themselves stay up. The script is tested locally against a stand-in host (74 cases, in `bun run check`).

`deploy/HOST-CHECKS.md` lists the fourteen checks on the host (H1 to H14), each with when to run it and
what to expect: Caddy's reload path and lock, the live site file's hash, the host reaching its own sites,
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
| Visitor | the address from `X-Forwarded-For`, believed only from loopback (IPv6 by its /64 block) |
| Errors | `development: false`: no error page with code (a check in `bun run check` keeps it so) |
| What is stored | the Playground's pose and its last 200 changes, each with a random author id made by the server; the only text written by a client is a request's group name ([D-41](../20-decisions/decision-log.md#d-41)). The page says so under More → "About this sandbox" |

## Order of the first rollout

The deploy's checks need the host's route before the first release that contains `server/`; otherwise
every automatic deploy would stop at the route probe. So:

1. `setup-server.sh --check` on the host; read every line (H1–H6, H9–H11, H13); the owner says yes.
2. `setup-server.sh --apply` inside tmux: the Caddy route and its 404 rule, then the service, which
   retries every 2 s until a release with `server/` is live.
3. `setup-server.sh --probe` (H7) and the load test H14.
4. Only then: merge the platform branch (`platform-step1-main`) to `main` and push. The automatic deploy
   asks `api/health` first (a 404 stops it before the upload), switches the release, the service starts
   from it, and `api/health` must report the new revision within 20 s.
5. `setup-server.sh --check` again (H8, H12); on the laptop `bun tools/live-idle-test.ts --url
   https://mightwork.ai/rigtwin` (ten minutes idle through Caddy, then one change and its undo in the
   public Playground); then the two-browser test on the live site.

**Status on 2026-11-24.** All five steps have run, with the owner's yes for the setup and for the merge:

| Step | What happened |
|---|---|
| `--check`, first run | stopped: port 4180 was used by another site's server. rigtwin moved to 4190 ([D-45](../20-decisions/decision-log.md#d-45)) |
| `--check`, second run | passed: Caddy reloads with `--force` and does not watch files; only this script takes the Caddy lock; the live site file is the expected one; every site on the host answered; no proxy in front; systemd 255, kernel 6.8, 2 cores; room in the journal; 37 GB free; all tools present. H10 found one other site's files under `/opt`, which is why the unit hides `/opt` |
| `--apply` | the user and the data folder; Bun 1.4.0 (checksum matched); the Caddy file installed with a backup, validated and reloaded; every other site answered with the same status before and after; `api/health` answers 502 (the route is there, no server yet) and `server/server.js` 404; the unit installed and enabled, retrying every 2 s until a release with `server/` is live |
| `--probe` (H7) | passed with the unit as installed then (86 settings): serves on loopback, sees only `rigtwin` under `/srv`, writes its data folder, cannot reach the internet |
| H14 | failed once on the kernel's TCP memory, passed with the stream byte budget ([above](#host-check-h14-live-streams-that-do-not-read)) |
| The unit, changed after that | the unit installed first hid other programs' folders by name; the repository's unit uses the rule for `/var/lib` that names nothing, and the probe checks `/opt` and `/var/lib` too. It was installed again and probed again (passed), and H14 passed with the final bundle |
| The merge and the first release (step 4) | the first push to `main` was refused by the deploy's own check on the runner, before any upload: the new command and server tests ran before the build, and the setup script's test used two commands in their macOS form. Fixed in `ff90f30`, which deployed: `api/health` reports revision `ff90f30`, viewer and wiki answer 200 |
| The host after the release (step 5) | `--check` again: `server/server.js` answers 404 in seven spellings (H12); the unit's exposure score is 1.4, its limits in effect (H8); the service is active |
| The two-browser check on the live site (step 5) | `bun tools/live-site-check.ts https://mightwork.ai/rigtwin`: passed, nine lines ok in 4.4 s. A turn of the monitor from the command line appeared in both pages with "Claude Code · 5145 — Monitor: turn 1° right"; Undo on one page put it back in both; a slider move in one page appeared in the other and `history.undo` of its version put it back; a view command reached only the named page; nothing was logged; the public scene's pose was the same before and after |
| The ten-minute idle test (step 5) | started after the release; its result is recorded in the [project log](../log.md) |

The release that goes out is the platform **without the manikin**: no person in the viewer, no Person
button, no `manikin.json` in the release. The person appears on mightwork.ai only after the owner approves
the new manikin ([D-44](../20-decisions/decision-log.md#d-44)).
