#!/bin/bash
# Local test of `bun run deploy --rollback` (tools/deploy.ts, builder D, step 1): the rollback floor (no going back to a
# release without a server once the live one has one) and the server checks after a rollback. The server side is a
# folder on this machine: a stand-in `ssh` on PATH runs each remote command locally (on macOS with BSD `mv -h` for GNU `mv -T`),
# and a local web server serves <root>/current at the root like Caddy, with /api/* answered by a stand-in
# server that reports the revision of the live release. No network beyond 127.0.0.1. Run `bun run dist` first.
#   bash tools/deploy-tests/rollback.test.sh
set -uo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
T=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/rollback-test.XXXXXX")" && pwd -P)
export SYNERGON_AGENT=builder-D-test
DIST=${SYNERGON_DIST_TEST_DIR:-"$REPO/dist"}
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }
expect() { if eval "$2"; then ok "$1"; else no "$1"; fi; }

mkdir -p "$T/bin" "$T/srv/synergon/releases"
cat >"$T/bin/ssh" <<'EOF'
#!/bin/bash
cmd="${!#}"
# GNU mv (Linux, the CI) knows -T; BSD mv (macOS) has -h for the same purpose
if mv --version 2>/dev/null | grep -q GNU; then exec /bin/sh -c "$cmd"; else exec /bin/sh -c "${cmd//mv -T /mv -h }"; fi
EOF
chmod +x "$T/bin/ssh"

# release <name> <revision> <with server: 1|0>: dist/ with its own version.json
release() {
  local d="$T/srv/synergon/releases/$1"
  mkdir -p "$d"
  for f in "$DIST"/*; do [[ "$(basename "$f")" == version.json ]] || ln -s "$f" "$d/$(basename "$f")"; done
  REV=$2 SRV=$3 bun -e '
    const v = JSON.parse(await Bun.file(process.argv[1]).text());
    v.revision = process.env.REV; v.short = "test " + process.env.REV;
    if (process.env.SRV !== "1") delete v.server; else v.server = { format: "synergon-scene/1" };
    await Bun.write(process.argv[2], JSON.stringify(v, null, 1) + "\n");' "$DIST/version.json" "$d/version.json"
}
switch_to() { ln -sfn "$T/srv/synergon/releases/$1" "$T/srv/synergon/current"; }
live() { basename "$(readlink "$T/srv/synergon/current")"; }

# the site: like Caddy, with the API answered by a stand-in that reports the live release's revision, lists one
# workspace and returns its metadata row (the checks a deploy or rollback makes of a server, tools/deploy.ts)
cat >"$T/site.ts" <<EOF
import { serveFolder } from "$REPO/tools/dist.ts";
import { readFileSync } from "node:fs";
const WS = { id: "00000000-0000-4000-8000-000000000001", name: "Playground", created: "2026-11-25T00:00:00.000Z", changed: "2026-11-25T00:00:00.000Z" };
const api = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/api/health") return Response.json({ ok: true, revision: JSON.parse(readFileSync("$T/srv/synergon/current/version.json", "utf8")).revision, format: "synergon-scene/1", mode: "deployed" });
  if (path === "/api/workspaces") return Response.json({ workspaces: [WS], next: null, total: 1 });
  if (path === "/api/workspaces/" + WS.id) return Response.json(WS);
  return new Response("no", { status: 404 });
} });
const s = serveFolder("$T/srv/synergon/current", "/", { api: "http://127.0.0.1:" + api.port });
console.log(s.server.port);
EOF
bun "$T/site.ts" >"$T/site.port" 2>"$T/site.err" &
SITE=$!
trap 'kill $SITE 2>/dev/null; [[ -n "${KEEP:-}" ]] || rm -rf "$T"' EXIT
for _ in $(seq 1 50); do [[ -s "$T/site.port" ]] && break; sleep 0.1; done
PORT=$(head -1 "$T/site.port")
printf '{"host": "fakehost", "remoteRoot": "%s", "publicUrl": "http://127.0.0.1:%s/", "keepReleases": 5}\n' "$T/srv/synergon" "$PORT" >"$T/test.config.json"
rollback() { (cd "$REPO" && PATH="$T/bin:$PATH" bun tools/deploy.ts --rollback --config "$T/test.config.json" "$@") >"$T/$NAME.log" 2>&1; echo $? >"$T/$NAME.rc"; }

echo "rollback test (logs in $T, removed at the end)"

echo "1. live release with a server, the one before without: refused"
release 20261120T000000Z-aaaaaaa aaaaaaa 0
release 20261124T000000Z-bbbbbbb bbbbbbb 1
switch_to 20261124T000000Z-bbbbbbb
NAME=floor rollback
expect "exit non-zero" '[[ $(cat "$T/floor.rc") != 0 ]]'
expect "says why" 'grep -q "refusing to roll back: the live release 20261124T000000Z-bbbbbbb has a server and 20261120T000000Z-aaaaaaa has none" "$T/floor.log"'
expect "current unchanged" '[[ $(live) == 20261124T000000Z-bbbbbbb ]]'
expect "both version.json files read with cat (gate pattern)" '[[ $(grep -c "ssh -o BatchMode=yes -o ConnectTimeout=20 fakehost .cat $T/srv/synergon/releases/2026112[04]T000000Z-[ab]*/version.json" "$T/floor.log") == 2 ]]'

echo "2. both with a server: rolled back, and the server's health reports the older revision"
release 20261122T000000Z-ccccccc ccccccc 1
NAME=both rollback
expect "exit 0" '[[ $(cat "$T/both.rc") == 0 ]]'
expect "current is the older server release" '[[ $(live) == 20261122T000000Z-ccccccc ]]'
expect "health check ran and passed" 'grep -q "ok   server: api/health reports revision ccccccc within 20 s" "$T/both.log"'
expect "server.js not served" 'grep -q "ok   server code not served" "$T/both.log"'
expect "summary names the server" 'grep -q "server: running revision ccccccc" "$T/both.log"'

echo "3. neither with a server: rolled back as before, no health check"
rm -rf "$T/srv/synergon/releases/"*
release 20261120T000000Z-aaaaaaa aaaaaaa 0
release 20261121T000000Z-ddddddd ddddddd 0
switch_to 20261121T000000Z-ddddddd
NAME=neither rollback
expect "exit 0, rolled back" '[[ $(cat "$T/neither.rc") == 0 && $(live) == 20261120T000000Z-aaaaaaa ]]'
expect "no health check" '! grep -q "api/health" "$T/neither.log"'
expect "summary: no server in this release" 'grep -q "server: no server in this release" "$T/neither.log"'

echo "4. live release without a server, the one before with one (cannot happen in order, but allowed): rolled back"
rm -rf "$T/srv/synergon/releases/"*
release 20261120T000000Z-eeeeeee eeeeeee 1
release 20261121T000000Z-fffffff fffffff 0
switch_to 20261121T000000Z-fffffff
NAME=up rollback
expect "exit 0, rolled back" '[[ $(cat "$T/up.rc") == 0 && $(live) == 20261120T000000Z-eeeeeee ]]'

echo "5. --dry-run prints the floor rule and the server checks"
NAME=dry rollback --dry-run
expect "exit 0" '[[ $(cat "$T/dry.rc") == 0 ]]'
expect "prints the refusal rule and both cat commands" 'grep -q "refused, before the switch" "$T/dry.log" && [[ $(grep -c "would run: .*cat .*version.json" "$T/dry.log") == 2 ]]'
expect "prints the server.js and api/health checks" 'grep -q "server/server.js  → anything but 200" "$T/dry.log" && grep -q "api/health  → for a release with a server: its revision within 20 s" "$T/dry.log"'
expect "nothing changed" '[[ $(live) == 20261120T000000Z-eeeeeee ]]'

echo
echo "rollback test: $PASS passed, $FAIL failed"
[[ $FAIL == 0 ]]
