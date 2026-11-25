# Host checks for the Synergon setup on the production host

From the security review of platform step 1 (H1–H13), plus H14 from round 3, adapted to the host layout of Synergon
(deploy account `synergon-deploy`, folders `/srv/synergon`, `/opt/synergon`, `/var/lib/synergon`, service `synergon-server`
on port 4191, Caddy site `synergon.caddy`; the cutover from the earlier layout is described in the owner's runbook, not in
this repository). Run on the production host as root, during the setup, with the owner's yes. Everything here is read-only except `--apply` itself and the `--probe` run (a transient
unit and a probe file that is removed).

`bash ~/synergon-setup/setup-server.sh --check` prints H1–H6 and H9–H13 itself (H8 and H12 once a release with
`server/` is live), each with what to expect. Compare every line with its "expect"; stop at the first surprise.

| # | When | What | Expect | How |
|---|---|---|---|---|
| H1 | before `--apply` | Caddy's reload path, no file watching | `caddy reload … --force`, no `--watch`; `admin` not `off` | `--check` |
| H2 | before | other tools take the same lock | the tools that change Caddy are listed | `--check` |
| H3 | before | the apex site file live today is the expected one; owners and modes; there is no `synergon.caddy` yet | the apex file's SHA-256 equals the one the runbook names (taken from the old checkout before the rename); the other site files are listed with their owners | `--check` |
| H4 | before | the host reaches its own sites | no `000` for the existing sites; `synergon.mightwork.ai` has no site yet (000 is right until `--apply`); after `--apply` `/` 404 until the first release (then 200), `api/health` 502 until the service runs (then 200), `server/server.js` 404 | `--check` ("status before") |
| H5 | before | no proxy or CDN in front (the visitor keys depend on it) | the A/AAAA records of `synergon.mightwork.ai` are among the host's own addresses | `--check` |
| H6 | before | systemd, kernel, cgroups, cores | systemd ≥ 247, kernel ≥ 5.8, `cgroup2fs`, ≤ 32 cores (`TasksMax=128`) | `--check` |
| H7 | after `--apply`, before the merge, and after every change of the unit | Bun 1.4.0 starts under the unit's hardening | `serve ok`, `srv ["synergon"]`, `opt ["synergon"]`, `varlib ["synergon"]`, `write ok`, `egress blocked`, then "probe passed" | `setup-server.sh --probe` (the settings are read from the unit file itself) |
| H8 | after the first release with `server/` | exposure score and limits in effect | exposure ≲ 2; `IPAddressDeny`, `MemoryMax`, `TasksMax`, CPU quota as in the unit | `--check` |
| H9 | before | room in the journal for the start attempts before the first server release | room for about 170,000 lines a day, or the unit's `LogRateLimit*` (now set) | `--check` |
| H10 | before | other sites' files outside `/srv` | none, or only under `/opt` and `/var/lib`: the unit replaces `/srv`, `/opt` and `/var/lib` by empty read-only folders holding only synergon's own part, without naming anything else (`--probe` checks it). A site root anywhere else: hide it in the unit before `--apply` | `--check` |
| H11 | before | data disk; Caddy access logs | free space well above 200 MB and 5 %; whether access logs are kept (the page says visitors' addresses are not stored by Synergon) | `--check` |
| H12 | after the first release with `server/` | nothing of `server/` is served, in any spelling | every line 404 | `--check` |
| H13 | before | the tools the script needs | every one found | `--check` |
| H14 | after `--apply`, before the merge | many live streams that do not read (security review M2): the server stays responsive, its memory and the kernel's TCP memory bounded | `stream load: passed` (resident memory below 150 MB; health within a second throughout; every stream ended by the server; none given more than 512 kB; TCP memory below the pressure threshold) | see below |

## H14: slow live streams on the host's own kernel

The server ends a live stream once it has been given 512 kB in all, read or not (`streamBytesMax` in
`server/limits.ts`; the browser reconnects with `since=` and gets only the changes it missed), closes one whose queue
passes 1 MB, takes at most 150 streams (12 per network block), and serialises each change and the snapshot once for
all streams. On the laptop (macOS) the queue limit is only reached after the kernel's own socket
buffers are full: macOS grows loopback send buffers to 4 MB each, and 300 stalled loopback connections then exhaust
its network memory (measured: every 2 kB cluster in use), after which `sendto` fails for every socket and Bun spins.
That was reproduced with a 20-line Bun server without any synergon code, for event streams and WebSockets alike, so it
says nothing about the host. On the host the visitors' connections end at Caddy, and Linux bounds TCP memory
(`tcp_mem`); this must be measured there once, against a throwaway server on another port:

```
# copied to the host with the setup files: scp tools/deploy-tests/stream-load.ts <host>:synergon-setup/
# a throwaway server from the live release's bundle, on a free loopback port, with a temporary data folder
/opt/synergon/runtime/bun ~/synergon-setup/stream-load.ts --seconds 60 \
  --bundle /srv/synergon/current/server/server.js --asset /srv/synergon/current/asset
cat /proc/net/sockstat          # before and during: "TCP: ... mem" in pages
```
(Before the first release with `server/` there is no bundle on the host: build one on the laptop with
`bun run dist` and copy `dist/server/server.js` and `dist/asset/` next to the script.)

The script prints the TCP memory every 5 s itself (from `/proc/net/sockstat`, against the second number of
`/proc/sys/net/ipv4/tcp_mem`, the pressure threshold) and fails if it reaches the threshold. If it fails, lower
`streamsTotal` and `streamsPerBlock` or `streamBytesMax` in `server/limits.ts` before the merge.

**Results of 2026-11-24 on the host.**
- First run (300 streams taken, no byte budget): **failed.** The server stayed healthy (peak 77 MB resident, health in
  0–1 ms, about 10 % CPU), but the kernel's TCP memory reached 59,172 pages against a pressure threshold of 58,837
  (`tcp_mem` = 44127 58837 88254): Linux took about 770 kB per non-reading stream into socket buffers, so the 1 MB
  queue limit never triggered ("0 of 300 slow streams closed", exit 1).
- Fix: the per-stream byte budget of 512 kB (a stream that has been given that much is ended after its last event;
  its place in the limits stays taken until its connection is gone, at most 45 s, so reconnecting does not multiply
  the buffers), 150 streams in all and 12 per network block: at worst about 150 × 0.5 MB = 75 MB of socket memory.
- Second run (the bundle with the fix, SHA-256 `270ec3ab…`, 60 s, 300 streams asked for): **passed.** 150 of 150
  taken streams ended by the server, largest 527,904 bytes, server peak 66 MB, health 0–1 ms throughout, TCP memory
  peak 28,698 pages (49 % of the pressure threshold), the host's other sites unaffected.
- After that run the server gained one small change: a stream that reaches its budget ends with an `end` event (the
  page reconnects at once). The limits are unchanged.

## The order of the first rollout

1. `--check`, read every line (H1–H6, H9–H11, H13); the owner says yes.
2. `--apply` inside tmux (the Caddy route and its 404 rule, then the service, which retries every 2 s).
3. `--probe` (H7) and H14. After any later change of the unit: `--apply` (it installs the new unit and restarts the
   service) and `--probe` again, before a release relies on it.
4. Only then: deploy the first release (`bun run deploy`, or merge to `main`). The deploy first asks `api/health` (with no release live yet): a 404 would mean the route is missing, and it stops without uploading or switching anything.
5. After the deploy: `--check` again (H8, H12), then `bun tools/live-idle-test.ts --url https://synergon.mightwork.ai`.
6. Once the new site is live and the data is moved: `--retire-apex` (mightwork.ai then answers 404 for everything; the
   script refuses unless `https://synergon.mightwork.ai/` and `/api/health` answer 200, and puts the file from before
   at `/var/backups/synergon-setup/mightwork-apex.caddy.before-retire`; `--restore-apex` reverses it). Then `--check`
   again: every other site answers as before.
