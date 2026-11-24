#!/bin/bash
# deploy/setup-server.sh: one-time setup of the rigtwin server on the production host, and its undo.
#
#   setup-server.sh --check                change nothing; print the current state, the host checks (deploy/HOST-CHECKS.md)
#                                          and what --apply would do
#   setup-server.sh --apply                install; idempotent (a second run changes nothing)
#   setup-server.sh --probe                after --apply: run Bun under the unit's hardening once on 127.0.0.1 (host check H7)
#   setup-server.sh --undo [--purge-data]  remove the service, the route and the runtime; the data folder and the
#                                          system user are kept unless --purge-data is given
#
# Runs as root on the production host only (the host that serves https://mightwork.ai/rigtwin/ from /srv/rigtwin
# with /etc/caddy/managed-sites/mightwork-apex.caddy), and only with the owner's yes. It reads the two files it
# installs from its own folder, so copy all three to the host and run it there:
#   scp deploy/setup-server.sh deploy/mightwork-apex.caddy deploy/rigtwin-server.service <host>:rigtwin-setup/
#   then on the host, as root, inside tmux (so that a dropped connection does not end the script half-way):
#     tmux new -s rigtwin-setup 'bash ~/rigtwin-setup/setup-server.sh --check 2>&1 | tee -a /root/rigtwin-setup.out'
#   or without tmux:  systemd-run --scope --unit rigtwin-setup bash ~/rigtwin-setup/setup-server.sh --apply
# Every run also appends its messages to /var/log/rigtwin-setup.log, and every change goes to the system log
# (journalctl -t rigtwin-setup). If the script is cut off (hang-up, Ctrl-C, a closed output) while a new Caddy site
# file is not yet confirmed, its exit trap puts the backup back and reloads Caddy before it writes anything.
# Every Caddy reload (a restore is a second one) closes the upgraded and streaming connections of every site on the
# host for a moment (Caddy's documentation); the sites themselves stay up.
#
# --apply, in this order (the Caddy route and the 404 for /rigtwin/server/* go live before any release that contains
# server/, so the deploy's new checks pass from the first such release on):
#   1. the system user rigtwin (no login, no home) and the data folder /var/lib/rigtwin (0700, owned by rigtwin)
#   2. Bun 1.4.0 at /opt/rigtwin/runtime/bun, from the official release zip for this machine, checked against the
#      SHA-256 pinned below before anything is installed
#   3. the Caddy site file, under the host's Caddy lock: the new file validated on its own, a timestamped backup of
#      the old one, the new one installed, `caddy validate` of the whole configuration, `systemctl reload caddy`;
#      then /rigtwin/ must answer 200, /rigtwin/server/server.js 404, /rigtwin/api/health must reach the new route
#      (502 until the service runs) and every other site must answer as before. On any failure the backup is put
#      back and Caddy is reloaded.
#   4. the unit rigtwin-server.service: checked with systemd-analyze, installed, enabled, started. Until a release
#      with server/ is live, each start fails and systemd tries again every 2 s; the first such release starts it.
# Before and after, the status of every Caddy site (one request per host name in /etc/caddy/Caddyfile and
# /etc/caddy/managed-sites/*.caddy) and of the services caddy and rigtwin-server is printed; a site or Caddy that
# answers differently afterwards is reported loudly. Every change also goes to the system log
# (journalctl -t rigtwin-setup).

if [ -z "${BASH_VERSION:-}" ]; then echo "setup-server.sh: run it with bash" >&2; exit 2; fi
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NEW_SITE="$SCRIPT_DIR/mightwork-apex.caddy"
NEW_UNIT="$SCRIPT_DIR/rigtwin-server.service"

CADDY_MAIN=/etc/caddy/Caddyfile
CADDY_SITES=/etc/caddy/managed-sites
SITE_FILE=/etc/caddy/managed-sites/mightwork-apex.caddy
CADDY_LOCK=/run/lock/caddy-config.lock        # taken by every tool on the host that changes Caddy's configuration
BACKUP_DIR=/var/backups/rigtwin-setup
FIRST_BACKUP=/var/backups/rigtwin-setup/mightwork-apex.caddy.before-setup   # the site file before the first --apply
UNIT_NAME=rigtwin-server
UNIT_FILE=/etc/systemd/system/rigtwin-server.service
SVC_USER=rigtwin
DATA_DIR=/var/lib/rigtwin
SRV_DIR=/srv/rigtwin
OPT_DIR=/opt/rigtwin
RUNTIME_DIR=/opt/rigtwin/runtime
PORT=4190
PUBLIC=https://mightwork.ai/rigtwin

BUN_VERSION=1.4.0
BUN_URL_BASE=https://github.com/oven-sh/bun/releases/download/bun-v1.4.0
# SHA-256 of the official release zips, copied from SHASUMS256.txt of the GitHub release bun-v1.4.0
# (https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/SHASUMS256.txt, read on 2026-11-24; identical to the
# digests GitHub's API reports for the same files). The baseline build is for x64 processors without AVX2.
BUN_SHA256_X64=2d03fb5fb83ac8b567aca0a281b2ce1a1a19d488f56c2968d88c3f25e92fe452
BUN_SHA256_X64_BASELINE=184fb4595f0d401a217cf7c78c1bc430ba83314dab7a8b94805babbf7fa7097f
BUN_SHA256_AARCH64=4b1a332ee861983eb93bcfe6f770fff94e3e31b2c388bdaea3c8ed35e58eed0e

LOG=/var/log/rigtwin-setup.log
TMP=""
CADDY_RESTORE=""   # the backup to put back if the script stops while a new site file is not yet confirmed

# ------------------------------------------------------------------------------------------------ output
# Each message goes to the log file first and then to the output: a dead output (dropped session) loses nothing.
log_line() { printf '%s\n' "$*" >>"$LOG" 2>/dev/null || true; }
say() { log_line "$*"; printf '%s\n' "$*"; }
step() { log_line "== $*"; printf '\n== %s\n' "$*"; }
BAR='!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
loud() { log_line "!!! $*"; printf '\n%s\n!!! %s\n%s\n' "$BAR" "$*" "$BAR"; }
die() { loud "STOPPED: $*"; exit 1; }
changed() { say "  changed: $*"; logger -t rigtwin-setup -- "$*" 2>/dev/null || true; }
would() { say "  would: $*"; }
indent() { sed 's/^/    /'; }

# ------------------------------------------------------------------------------------------------ host probes
# (small functions so that the local test harness, work/build/setup-test/, can stand in for the host)
host_is_systemd_linux() { [[ "$(uname -s)" == Linux && -d /run/systemd/system ]]; }
owner_mode() { stat -c '%U:%G %a' "$1"; }
cpu_has_avx2() { grep -qw avx2 /proc/cpuinfo; }
port_listeners() { ss -Hltnp "sport = :$PORT" 2>/dev/null || true; }
nologin_shell() { local s; for s in /usr/sbin/nologin /sbin/nologin; do [[ -x "$s" ]] && { echo "$s"; return 0; }; done; echo /bin/false; }
runtime_version() { "$RUNTIME_DIR/bun" --version 2>/dev/null || true; }
live_has_server() { [[ -e "$SRV_DIR/current/server" ]]; }
file_sha256() { sha256sum "$1" | cut -d' ' -f1; }
# "-m <mode> -o <uid> -g <gid>" of a file, for install(1) to keep them
keep_owner_mode() { stat -c '-m %a -o %u -g %g' "$1"; }

# "<zip name without .zip> <sha256>" of the Bun build for this machine
bun_zip() {
  case "$(uname -m)" in
    x86_64 | amd64) if cpu_has_avx2; then echo "bun-linux-x64 $BUN_SHA256_X64"; else echo "bun-linux-x64-baseline $BUN_SHA256_X64_BASELINE"; fi ;;
    aarch64 | arm64) echo "bun-linux-aarch64 $BUN_SHA256_AARCH64" ;;
    *) return 1 ;;
  esac
}
extract_zip() {
  if command -v unzip >/dev/null; then unzip -q "$1" -d "$2"; else python3 -m zipfile -e "$1" "$2"; fi
}
# true when nothing listens on the port, or only this service does
port_free_or_ours() {
  local l pid
  l=$(port_listeners)
  [[ -z "$l" ]] && return 0
  pid=$(systemctl show -p MainPID --value "$UNIT_NAME" 2>/dev/null || echo 0)
  [[ -n "$pid" && "$pid" != 0 && "$l" == *"pid=$pid,"* ]]
}
unit_state() {
  local e a
  e=$(systemctl is-enabled "$1" 2>/dev/null || true); a=$(systemctl is-active "$1" 2>/dev/null || true)
  printf 'enabled=%s active=%s' "${e:-not-installed}" "${a:-unknown}"
}
http_code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || true; }

# ------------------------------------------------------------------------------------------------ the status of every site
# The address line of every top-level site block: a line at brace depth 0 that ends with "{" and is not the global
# options block, a snippet "(name) {", a named route "&(name) {" or an import.
site_addresses() {
  local files=() f
  for f in "$CADDY_MAIN" "$CADDY_SITES"/*.caddy; do [[ -f "$f" ]] && files+=("$f"); done
  awk '
    FNR == 1 { depth = 0 }
    {
      line = $0; sub(/(^|[ \t])#.*$/, "", line)
      if (depth == 0 && line ~ /\{[ \t]*$/ && line !~ /^[ \t]*[({&]/ && line !~ /^[ \t]*import[ \t]/) {
        addr = line; sub(/\{[ \t]*$/, "", addr); print addr
      }
      depth += gsub(/\{/, "{", line) - gsub(/\}/, "}", line)
    }' "${files[@]}"
}
# One URL per host name: wildcards, placeholders, bare ports, localhost and IP addresses are left out.
site_urls() {
  local a scheme rest host port
  site_addresses | tr ',' ' ' | tr -s ' \t' '\n' | while read -r a; do
    [[ -n "$a" ]] || continue
    scheme=https; rest=$a
    case "$rest" in http://*) scheme=http; rest=${rest#http://} ;; https://*) rest=${rest#https://} ;; esac
    rest=${rest%%/*}; host=${rest%%:*}; port=""
    [[ "$rest" == *:* ]] && port=${rest#*:}
    [[ -n "$host" && "$host" != *'*'* && "$host" != *'{'* && "$host" != localhost && "$host" != '['* ]] || continue
    [[ "$host" =~ ^[0-9.]+$ ]] && continue
    if [[ "$port" == 80 ]]; then echo "http://$host/"
    elif [[ -n "$port" && "$port" != 443 ]]; then echo "$scheme://$host:$port/"
    else echo "$scheme://$host/"; fi
  done | sort -u
}
# Writes the status of every site, of the two services and of rigtwin's own routes to the file $1 and prints it.
snapshot() {
  local out=$1 url svc
  : >"$out"
  while read -r url; do printf 'site %s %s\n' "$url" "$(http_code "$url")" >>"$out"; done < <(site_urls)
  for svc in caddy "$UNIT_NAME"; do printf 'service %s %s\n' "$svc" "$(unit_state "$svc")" >>"$out"; done
  for url in "$PUBLIC/" "$PUBLIC/api/health" "$PUBLIC/server/server.js"; do printf 'rigtwin %s %s\n' "$url" "$(http_code "$url")" >>"$out"; done
  indent <"$out"
}
# Compares two snapshots. A site or Caddy that answers differently is reported loudly (status 1); the rigtwin
# routes and the rigtwin service are expected to change and are listed.
compare() {
  local d e
  d=$(diff <(grep -E '^(site |service caddy )' "$1") <(grep -E '^(site |service caddy )' "$2") || true)
  e=$(diff <(grep -E '^(rigtwin |service '"$UNIT_NAME"' )' "$1") <(grep -E '^(rigtwin |service '"$UNIT_NAME"' )' "$2") || true)
  [[ -z "$e" ]] || { say "  rigtwin's own routes and service (expected to change):"; printf '%s\n' "$e" | grep -E '^[<>]' | indent; }
  if [[ -n "$d" ]]; then
    loud "DIFFERENCE: a site or Caddy itself does not answer as it did before (< before, > after)"
    printf '%s\n' "$d" | grep -E '^[<>]' | indent
    return 1
  fi
  say "  every site and Caddy itself: the same status as before"
}

# ------------------------------------------------------------------------------------------------ checks of the files
caddy_validate() {   # $1: a Caddyfile; run with a throwaway data folder so that validation writes nothing
  local rc=0 d
  d=$(mktemp -d)
  XDG_DATA_HOME="$d" XDG_CONFIG_HOME="$d" caddy validate --adapter caddyfile --config "$1" >"$d/out" 2>&1 || rc=$?
  if [[ $rc -eq 0 ]]; then say "  caddy validate $1: valid"; else say "  caddy validate $1: FAILED"; tail -20 "$d/out" | indent; fi
  rm -rf "$d"
  return $rc
}
unit_verify() {   # systemd-analyze verify of the new unit; before the runtime exists, with a stand-in program
  local rc=0 d
  d=$(mktemp -d)
  if [[ -x "$RUNTIME_DIR/bun" ]]; then cp "$NEW_UNIT" "$d/$UNIT_NAME.service"
  else sed "s#^ExecStart=$RUNTIME_DIR/bun #ExecStart=/bin/true #" "$NEW_UNIT" >"$d/$UNIT_NAME.service"; fi
  systemd-analyze verify "$d/$UNIT_NAME.service" >"$d/out" 2>&1 || rc=$?
  if [[ $rc -eq 0 ]]; then say "  systemd-analyze verify: ok$( [[ -s "$d/out" ]] && echo ', with these notes:')"; else say "  systemd-analyze verify: FAILED"; fi
  indent <"$d/out"
  rm -rf "$d"
  return $rc
}

# ------------------------------------------------------------------------------------------------ Caddy changes
take_caddy_lock() { exec 9>"$CADDY_LOCK"; flock -w 60 9 || die "another tool holds $CADDY_LOCK; nothing was changed, try again later"; }
drop_caddy_lock() { flock -u 9 || true; exec 9>&-; }
# Replaces the site file with $1 under the lock; $2 is a check run after the reload (a function name). On any
# failure the exit trap puts the backup back and reloads Caddy.
switch_site_file() {
  local from=$1 check=$2 backup
  take_caddy_lock
  install -d -m 0700 "$BACKUP_DIR"
  backup="$BACKUP_DIR/mightwork-apex.caddy.$(date -u +%Y%m%dT%H%M%SZ)-$$"
  cp -p "$SITE_FILE" "$backup"
  [[ -e "$FIRST_BACKUP" ]] || cp -p "$SITE_FILE" "$FIRST_BACKUP"
  changed "backup of $SITE_FILE at $backup"
  diff -u "$SITE_FILE" "$from" | indent || true
  CADDY_RESTORE=$backup
  # shellcheck disable=SC2046
  install $(keep_owner_mode "$SITE_FILE") "$from" "$SITE_FILE"
  changed "installed $SITE_FILE (sha256 $(sha256sum "$SITE_FILE" | cut -d' ' -f1))"
  caddy_validate "$CADDY_MAIN" || die "the whole Caddy configuration does not validate with the new site file"
  systemctl reload caddy || die "systemctl reload caddy failed"
  changed "reloaded caddy"
  sleep 2
  "$check" || die "the site does not answer as expected after the reload"
  snapshot "$TMP/caddy-after" >/dev/null
  compare "$TMP/before" "$TMP/caddy-after" || die "another site answers differently after the reload"
  CADDY_RESTORE=""
  drop_caddy_lock
}
# Runs in the exit trap with errexit off: first the copy and the reload, then (and only then) any output, each write
# allowed to fail (the session may be gone). Security review M1.
restore_site_file() {
  [[ -n "$CADDY_RESTORE" ]] || return 0
  local from=$CADDY_RESTORE copied=0 reloaded=0
  CADDY_RESTORE=""
  cp -p "$from" "$SITE_FILE" && copied=1
  systemctl reload caddy >/dev/null 2>&1 && reloaded=1
  logger -t rigtwin-setup -- "restored $SITE_FILE from $from after the script stopped (copied=$copied reloaded=$reloaded)" 2>/dev/null || true
  loud "the script stopped while the new site file was not confirmed: the previous one was put back from $from and Caddy reloaded" || true
  if [[ $copied == 1 ]]; then say "  restored: $SITE_FILE is the backup again" || true
  else loud "COULD NOT PUT THE BACKUP BACK: copy $from to $SITE_FILE by hand now" || true; fi
  if [[ $reloaded == 1 ]]; then say "  restored: Caddy has reloaded it" || true
  else loud "Caddy did not reload: look at 'systemctl status caddy' now (a failed reload leaves Caddy running the configuration it had)" || true; fi
}
expect_code() {   # $1 url, $2 allowed codes separated by "|"
  local c; c=$(http_code "$1")
  if [[ "|$2|" == *"|$c|"* ]]; then say "  ok: $1 answers $c"; else say "  FAIL: $1 answers $c, expected $2"; return 1; fi
}
check_new_route() {
  local ok=0
  expect_code "$PUBLIC/" 200 || ok=1
  expect_code "$PUBLIC/server/server.js" 404 || ok=1
  expect_code "$PUBLIC/api/health" "502|503|200" || ok=1   # 404 would mean the new route is not in effect
  return $ok
}
check_old_route() {
  local ok=0
  expect_code "$PUBLIC/" 200 || ok=1
  expect_code "$PUBLIC/api/health" 404 || ok=1
  return $ok
}

# ------------------------------------------------------------------------------------------------ the steps
preflight() {
  [[ "$(id -u)" == 0 ]] || die "run this as root on the production host"
  host_is_systemd_linux || die "this is not a Linux host running systemd"
  local c
  for c in systemctl systemd-analyze caddy curl sha256sum flock ss logger install; do command -v "$c" >/dev/null || die "the command $c is missing"; done
  [[ -f "$CADDY_MAIN" && -d "$CADDY_SITES" ]] || die "no Caddy configuration at $CADDY_MAIN with $CADDY_SITES/"
  [[ -f "$SITE_FILE" && -d "$SRV_DIR" ]] || die "this is not the host that serves mightwork.ai/rigtwin ($SITE_FILE and $SRV_DIR are missing)"
  grep -Eq "^[[:space:]]*import[[:space:]]+[^#]*managed-sites" "$CADDY_MAIN" || die "$CADDY_MAIN does not import $CADDY_SITES/, so the site file would not be used"
  if [[ "$1" != --undo ]]; then
    [[ -f "$NEW_SITE" && -f "$NEW_UNIT" ]] || die "mightwork-apex.caddy and rigtwin-server.service must be next to this script ($SCRIPT_DIR)"
    bun_zip >/dev/null || die "no Bun build for this machine ($(uname -m)); x86_64 and aarch64 are supported"
    port_free_or_ours || die "port $PORT is in use by another program: $(port_listeners)"
  fi
  if [[ "$1" == --apply && "$(runtime_version)" != "$BUN_VERSION" ]]; then
    command -v unzip >/dev/null || command -v python3 >/dev/null || die "neither unzip nor python3 is installed, so the Bun zip cannot be unpacked"
  fi
}

header() {
  say "rigtwin setup $1 on $(hostname) at $(date -u +%Y-%m-%dT%H:%M:%SZ), as $(id -un)"
  say "  script folder $SCRIPT_DIR; messages also in $LOG, changes in journalctl -t rigtwin-setup"
  [[ -n "${TMUX:-}${INVOCATION_ID:-}" ]] || say "  (not inside tmux or systemd-run: if this session drops, the exit trap still restores Caddy, but run --apply inside tmux)"
  local f
  for f in "${BASH_SOURCE[0]}" "$NEW_SITE" "$NEW_UNIT"; do [[ -f "$f" ]] && say "  $(sha256sum "$f" | cut -d' ' -f1)  $(basename "$f")"; done
  say "  $(caddy version 2>/dev/null | head -1 || true) · $(systemctl --version 2>/dev/null | head -1 || true)"
  step "status before"
  snapshot "$TMP/before"
}

# ------------------------------------------------------------------------------------------------ host checks (read-only)
# The security review's H1-H13 that a script can run (deploy/HOST-CHECKS.md lists them all, with what to expect).
host_checks() {
  local f
  step "host checks (deploy/HOST-CHECKS.md): read-only; compare each with its 'expect'"
  say "  H1 Caddy reload and admin endpoint (expect: caddy reload ... --force, no --watch; admin not off)"
  { systemctl cat caddy 2>/dev/null | grep -E 'ExecStart|ExecReload'; grep -nE '^[[:space:]]*admin' "$CADDY_MAIN"; } 2>/dev/null | indent || true
  say "  H2 tools that take the Caddy lock (expect: the tools that change Caddy)"
  grep -rIl 'caddy-config.lock' /usr/local/bin /usr/local/sbin /etc /root 2>/dev/null | head -20 | indent || true
  say "  H3 the live site file and the owners of the site files (expect: the hash of deploy/mightwork-apex.caddy in the main checkout)"
  { file_sha256 "$SITE_FILE"; for f in "$CADDY_SITES"/*.caddy; do stat -c '%U:%G %a %n' "$f"; done; } 2>/dev/null | indent || true
  say "  H4 the sites as this host sees them: the 'status before' lines above (expect: no 000; /rigtwin/ 200, api/health 404 before the setup, server/server.js 404)"
  say "  H5 no proxy or CDN in front (expect: the A/AAAA records are among this host's addresses)"
  { echo "A: $(dig +short A mightwork.ai 2>/dev/null | tr '\n' ' ')AAAA: $(dig +short AAAA mightwork.ai 2>/dev/null | tr '\n' ' ')"; ip -br addr 2>/dev/null; } | indent || true
  say "  H6 systemd, kernel, cgroups, cores (expect: systemd >= 247, kernel >= 5.8, cgroup2fs, cores <= 32 for TasksMax=128)"
  echo "$(systemctl --version 2>/dev/null | head -1) · kernel $(uname -r 2>/dev/null) · $(stat -fc %T /sys/fs/cgroup 2>/dev/null || echo 'cgroup ?') · $(nproc 2>/dev/null || echo '?') cores" | indent || true
  say "  H7 Bun under the unit's hardening: after --apply, run --probe"
  if live_has_server; then
    say "  H8 the service's exposure and limits (expect: exposure <= 2; the unit's values)"
    { systemd-analyze security "$UNIT_NAME" --no-pager 2>/dev/null | tail -1; systemctl show "$UNIT_NAME" -p IPAddressDeny -p MemoryMax -p TasksMax -p TasksCurrent -p CPUQuotaPerSecUSec 2>/dev/null; } | indent || true
  else say "  H8 (after the first release with server/)"; fi
  say "  H9 the journal's room for the start attempts before the first server release (expect: room, or the unit's LogRateLimit)"
  { journalctl --disk-usage 2>/dev/null; grep -hE '^(SystemMaxUse|RateLimit)' /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*.conf 2>/dev/null; } | indent || true
  say "  H10 site roots outside /srv (expect: none, or each in the unit's InaccessiblePaths=)"
  grep -hE '^[[:space:]]*root\b' "$CADDY_MAIN" "$CADDY_SITES"/*.caddy 2>/dev/null | grep -v '/srv/' | indent || true
  say "  H11 data disk and access logs (expect: free space; whether Caddy keeps access logs: the page says addresses are not stored)"
  { df -h /var/lib 2>/dev/null | tail -1; grep -nE '^[[:space:]]*log\b' "$CADDY_MAIN" "$CADDY_SITES"/*.caddy 2>/dev/null; } | indent || true
  if live_has_server; then
    say "  H12 nothing of server/ is served (expect: every line 404)"
    for f in server/server.js server server/ /server/server.js %73erver/server.js SERVER/server.js api/../server/server.js; do printf '%s %s\n' "$(curl -s --path-as-is -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC/$f" 2>/dev/null || true)" "$f"; done | indent || true
  else say "  H12 (after the first release with server/)"; fi
  say "  H13 the tools this script uses (expect: every one found)"
  for f in unzip python3 ss flock systemd-analyze systemd-run curl caddy; do printf '%s %s\n' "$f" "$(command -v "$f" 2>/dev/null || echo MISSING)"; done | indent || true
}

# ------------------------------------------------------------------------------------------------ --probe (H7)
# The unit's confinement, read from the unit file itself: every [Service] setting except how it is started and restarted.
unit_properties() { awk '/^\[Service\]/{f=1; next} /^\[/{f=0} f && /^[A-Za-z]+=/' "$NEW_UNIT" | grep -vE '^(Type|ExecStart|Restart|RestartSec|TimeoutStopSec)='; }
PROBE_JS='(async()=>{const fs=require("fs");const s=Bun.serve({port:4181,hostname:"127.0.0.1",development:false,fetch:()=>new Response("ok")});console.log("serve",await (await fetch("http://127.0.0.1:4181/")).text());console.log("srv",JSON.stringify(fs.readdirSync("/srv")));fs.writeFileSync("/var/lib/rigtwin/.probe","x");console.log("write ok");try{await fetch("https://mightwork.ai/",{signal:AbortSignal.timeout(3000)});console.log("EGRESS OPEN")}catch{console.log("egress blocked")}s.stop(true)})()'
do_probe() {
  header --probe
  [[ -x "$RUNTIME_DIR/bun" ]] || die "Bun is not installed at $RUNTIME_DIR/bun: run --apply first"
  id -u "$SVC_USER" >/dev/null 2>&1 || die "the user $SVC_USER does not exist: run --apply first"
  local props=() line out
  while IFS= read -r line; do props+=(-p "$line"); done < <(unit_properties)
  step "H7. Bun $BUN_VERSION once under the unit's hardening (${#props[@]} settings from $(basename "$NEW_UNIT")), on 127.0.0.1:4181"
  out=$(systemd-run --wait --pipe --collect --quiet "${props[@]}" "$RUNTIME_DIR/bun" -e "$PROBE_JS" 2>&1 || true)
  printf '%s\n' "$out" | indent
  rm -f "$DATA_DIR/.probe"
  if [[ "$out" == *"serve ok"* && "$out" == *'srv ["rigtwin"]'* && "$out" == *"write ok"* && "$out" == *"egress blocked"* ]]; then say "probe passed: Bun serves on loopback, sees only /srv/rigtwin, writes its data folder, cannot reach the internet"
  else loud "probe did not give 'serve ok', 'srv [\"rigtwin\"]', 'write ok', 'egress blocked': the unit's hardening and Bun do not fit; do not merge yet"; return 1; fi
}

do_check() {
  header --check
  host_checks
  step "1. system user $SVC_USER and data folder $DATA_DIR"
  if id -u "$SVC_USER" >/dev/null 2>&1; then say "  ok: $(id "$SVC_USER")"; else would "create the system user $SVC_USER (no login shell, no home)"; fi
  if [[ ! -d "$DATA_DIR" ]]; then would "create $DATA_DIR (0700, owned by $SVC_USER)"
  elif [[ "$(owner_mode "$DATA_DIR")" == "$SVC_USER:$SVC_USER 700" ]]; then say "  ok: $DATA_DIR exists, $SVC_USER:$SVC_USER 700"
  else would "set $DATA_DIR (now $(owner_mode "$DATA_DIR")) to $SVC_USER:$SVC_USER 700"; fi

  step "2. Bun $BUN_VERSION at $RUNTIME_DIR/bun"
  local have name sha
  have=$(runtime_version); read -r name sha < <(bun_zip)
  if [[ "$have" == "$BUN_VERSION" ]]; then
    if [[ -f "$RUNTIME_DIR/bun.sha256" ]] && grep -qx "bun $(file_sha256 "$RUNTIME_DIR/bun")" "$RUNTIME_DIR/bun.sha256"; then say "  ok: installed, and the binary is the one installed from $(grep '^zip ' "$RUNTIME_DIR/bun.sha256" | cut -d' ' -f2)"
    else loud "$RUNTIME_DIR/bun prints $BUN_VERSION but its SHA-256 is not the one recorded in $RUNTIME_DIR/bun.sha256: reinstall (--undo, then --apply)"; fi
  else would "download $BUN_URL_BASE/$name.zip, check SHA-256 $sha, install $RUNTIME_DIR/bun${have:+ (now $have)}"; fi

  step "3. Caddy site $SITE_FILE"
  if cmp -s "$NEW_SITE" "$SITE_FILE"; then say "  ok: already the new site file"
  else
    would "back up the installed file to $BACKUP_DIR/, install the new one, validate the whole configuration, reload Caddy; the change:"
    diff -u "$SITE_FILE" "$NEW_SITE" | indent || true
    caddy_validate "$NEW_SITE" || say "  (the new file does not validate on its own: --apply would stop here)"
  fi
  [[ -e "$CADDY_LOCK" ]] && say "  the Caddy lock $CADDY_LOCK exists (it is taken with flock while changing Caddy)"

  step "4. service $UNIT_NAME"
  if cmp -s "$NEW_UNIT" "$UNIT_FILE"; then say "  ok: unit file installed"
  elif [[ -e "$UNIT_FILE" ]]; then would "replace $UNIT_FILE and restart the service; the change:"; diff -u "$UNIT_FILE" "$NEW_UNIT" | indent || true
  else would "install $UNIT_FILE, enable and start it"; fi
  unit_verify || say "  (--apply would stop here)"
  say "  now: $(unit_state "$UNIT_NAME")"
  if live_has_server; then say "  the live release contains server/: the service would start at once"
  else say "  the live release has no server/ yet: the service would retry every 2 s until a release with server/ is live"; fi
  if [[ -n "$(port_listeners)" ]]; then say "  port $PORT: $(port_listeners)"; else say "  port $PORT: free"; fi

  say ""
  say "check finished: nothing was changed"
}

do_apply() {
  header --apply

  step "1. system user $SVC_USER and data folder $DATA_DIR"
  if id -u "$SVC_USER" >/dev/null 2>&1; then say "  ok: $(id "$SVC_USER")"
  else useradd --system --user-group --no-create-home --home-dir /nonexistent --shell "$(nologin_shell)" "$SVC_USER"; changed "created the system user $SVC_USER"; fi
  if [[ -d "$DATA_DIR" && "$(owner_mode "$DATA_DIR")" == "$SVC_USER:$SVC_USER 700" ]]; then say "  ok: $DATA_DIR exists, $SVC_USER:$SVC_USER 700"
  else mkdir -p "$DATA_DIR"; chown "$SVC_USER:$SVC_USER" "$DATA_DIR"; chmod 0700 "$DATA_DIR"; changed "$DATA_DIR is $SVC_USER:$SVC_USER 700"; fi

  step "2. Bun $BUN_VERSION at $RUNTIME_DIR/bun"
  local name sha got v
  if [[ "$(runtime_version)" == "$BUN_VERSION" ]]; then say "  ok: installed"
  else
    read -r name sha < <(bun_zip)
    say "  downloading $BUN_URL_BASE/$name.zip"
    curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --max-time 600 -o "$TMP/$name.zip" "$BUN_URL_BASE/$name.zip" || die "the download failed; nothing was installed"
    got=$(sha256sum "$TMP/$name.zip" | cut -d' ' -f1)
    [[ "$got" == "$sha" ]] || die "SHA-256 of $name.zip is $got, but $sha is pinned; nothing was installed"
    say "  SHA-256 $got matches the pinned value"
    mkdir -p "$TMP/zip"; extract_zip "$TMP/$name.zip" "$TMP/zip"
    [[ -f "$TMP/zip/$name/bun" ]] || die "the zip has no $name/bun; nothing was installed"
    install -d -m 0755 "$OPT_DIR" "$RUNTIME_DIR"
    install -m 0755 "$TMP/zip/$name/bun" "$RUNTIME_DIR/bun.new"
    v=$("$RUNTIME_DIR/bun.new" --version 2>&1 || true)
    [[ "$v" == "$BUN_VERSION" ]] || { rm -f "$RUNTIME_DIR/bun.new"; die "the downloaded Bun does not run on this machine (it printed '$v'); nothing was installed"; }
    mv -f "$RUNTIME_DIR/bun.new" "$RUNTIME_DIR/bun"
    printf 'zip %s %s\nbun %s\n' "$name.zip" "$sha" "$(file_sha256 "$RUNTIME_DIR/bun")" >"$RUNTIME_DIR/bun.sha256"
    changed "installed Bun $BUN_VERSION at $RUNTIME_DIR/bun ($name.zip, SHA-256 $sha; recorded in $RUNTIME_DIR/bun.sha256)"
  fi

  step "3. Caddy site $SITE_FILE"
  if cmp -s "$NEW_SITE" "$SITE_FILE"; then say "  ok: already the new site file"
  else
    caddy_validate "$NEW_SITE" || die "the new site file does not validate on its own; nothing was changed in Caddy"
    switch_site_file "$NEW_SITE" check_new_route
  fi

  step "4. service $UNIT_NAME"
  local fresh=0 state
  if cmp -s "$NEW_UNIT" "$UNIT_FILE"; then say "  ok: unit file installed"
  else
    unit_verify || die "systemd-analyze verify rejects the unit; it was not installed"
    install -m 0644 "$NEW_UNIT" "$UNIT_FILE"; systemctl daemon-reload; fresh=1
    changed "installed $UNIT_FILE and reloaded systemd"
  fi
  if [[ "$(systemctl is-enabled "$UNIT_NAME" 2>/dev/null || true)" == enabled ]]; then say "  ok: enabled"
  else systemctl enable "$UNIT_NAME" 2>&1 | indent; changed "enabled $UNIT_NAME"; fi
  state=$(systemctl is-active "$UNIT_NAME" 2>/dev/null || true)
  if [[ $fresh == 1 || ( "$state" != active && "$state" != activating ) ]]; then systemctl restart "$UNIT_NAME"; changed "started $UNIT_NAME"
  else say "  ok: $state"; fi
  if live_has_server; then
    for _ in $(seq 1 20); do [[ "$(http_code "http://127.0.0.1:$PORT/api/health")" == 200 ]] && break; sleep 1; done
    if [[ "$(http_code "http://127.0.0.1:$PORT/api/health")" == 200 ]]; then say "  ok: the service answers http://127.0.0.1:$PORT/api/health"
    else loud "the live release contains server/, but the service does not answer within 20 s"; journalctl -u "$UNIT_NAME" -n 15 --no-pager 2>&1 | indent || true; fi
  else
    say "  the live release has no server/ yet: the service retries every 2 s and starts by itself once one is live"
    say "  (journalctl -u $UNIT_NAME shows each attempt)"
  fi

  step "status after"
  snapshot "$TMP/after"
  compare "$TMP/before" "$TMP/after" || die "see the difference above"
  say ""
  say "apply finished"
}

do_undo() {
  local purge=$1
  header --undo
  # refused as a whole, before anything is stopped: with server/ live the route must stay (its 404 rule hides
  # server/server.js) and a stopped service would make every later deploy fail its health check
  if live_has_server; then
    die "the live release contains server/. Switch $SRV_DIR/current to a release without server/ first (bun run deploy --rollback refuses this on purpose; do it by hand), then run --undo again. Nothing was changed."
  fi

  step "1. service $UNIT_NAME"
  if [[ -e "$UNIT_FILE" ]]; then
    systemctl disable --now "$UNIT_NAME" 2>&1 | indent || true
    rm -f "$UNIT_FILE"; systemctl daemon-reload; systemctl reset-failed "$UNIT_NAME" 2>/dev/null || true
    changed "stopped and disabled $UNIT_NAME, removed $UNIT_FILE"
  else say "  ok: no unit file"; fi

  step "2. Caddy site $SITE_FILE"
  if [[ ! -f "$FIRST_BACKUP" ]]; then say "  kept: there is no copy of the site file from before the first --apply ($FIRST_BACKUP)"
  elif cmp -s "$FIRST_BACKUP" "$SITE_FILE"; then say "  ok: already as before the setup"
  elif ! cmp -s "$NEW_SITE" "$SITE_FILE"; then
    loud "the installed site file is neither the one --apply installed nor the one from before the setup: someone has changed it since. It was left as it is; the difference to the setup's file:"
    diff -u "$NEW_SITE" "$SITE_FILE" | indent || true
    die "put back $FIRST_BACKUP by hand if that is right"
  else
    caddy_validate "$FIRST_BACKUP" || die "the site file from before the setup does not validate on its own"
    switch_site_file "$FIRST_BACKUP" check_old_route
  fi

  step "3. Bun at $RUNTIME_DIR"
  if [[ -e "$RUNTIME_DIR" ]]; then
    rm -f "$RUNTIME_DIR/bun" "$RUNTIME_DIR/bun.new" "$RUNTIME_DIR/bun.sha256"; rmdir "$RUNTIME_DIR" 2>/dev/null || true; rmdir "$OPT_DIR" 2>/dev/null || true
    changed "removed $RUNTIME_DIR/bun"
  else say "  ok: not installed"; fi

  step "4. data folder $DATA_DIR and system user $SVC_USER"
  if [[ "$purge" == 1 ]]; then
    if [[ -e "$DATA_DIR" ]]; then rm -rf "$DATA_DIR"; changed "deleted $DATA_DIR"; fi
    if id -u "$SVC_USER" >/dev/null 2>&1; then userdel "$SVC_USER"; changed "deleted the system user $SVC_USER"; fi
  else say "  kept (--purge-data deletes both)"; fi

  step "status after"
  snapshot "$TMP/after"
  compare "$TMP/before" "$TMP/after" || die "see the difference above"
  say ""
  say "undo finished"
}

usage() {
  sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit "${1:-2}"
}
on_exit() {
  local rc=$?
  set +e; trap '' HUP INT TERM PIPE        # nothing may stop the restore half-way now
  restore_site_file
  [[ -z "$TMP" ]] || rm -rf "$TMP"
  exit $rc
}

main() {
  local mode="" purge=0 a
  for a in "$@"; do
    case "$a" in
      --check | --apply | --undo | --probe) [[ -z "$mode" ]] || usage; mode=$a ;;
      --purge-data) purge=1 ;;
      -h | --help) usage 0 ;;
      *) usage ;;
    esac
  done
  [[ -n "$mode" ]] || usage
  [[ $purge == 0 || "$mode" == --undo ]] || die "--purge-data goes with --undo only"
  # a broken output pipe must not kill the script before its exit trap: writes then fail, errexit ends the script
  # and the trap restores; a hang-up, Ctrl-C or kill ends it through the same trap
  trap '' PIPE
  preflight "$mode"
  TMP=$(mktemp -d)
  trap on_exit EXIT
  trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
  log_line ""; log_line "---- $(date -u +%Y-%m-%dT%H:%M:%SZ) setup-server.sh $mode"
  case "$mode" in
    --check) do_check ;;
    --apply) do_apply ;;
    --probe) do_probe ;;
    --undo) do_undo "$purge" ;;
  esac
}

# Run unless sourced (the local test harness sources the script and stands in for the host's commands).
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
