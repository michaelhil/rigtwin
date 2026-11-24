#!/bin/bash
# Local test of deploy/setup-server.sh (builder D, step 1). Runs the real script against a fake host folder, with
# the host's system commands (systemctl, caddy, curl, useradd, ...) stood in by shell functions that record what
# was asked of them and emulate Caddy's routing from the site file it last "reloaded".
#
#   bash tools/deploy-tests/setup-server.test.sh [path/to/setup-server.sh]
#
# Each scenario runs in its own subshell and fake root; the output of every run is kept in $OUT for reading, and the
# end of a run's output is printed below its first failed expectation (lines "log> ...", which `bun run check` shows).
# The harness must run with BSD tools (macOS) and GNU tools (the CI's Ubuntu) alike: no `stat -f`, no `sed -i ''`.
set -uo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)     # the repository of this test (the site file live before the setup is the fixture tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy, SHA-256 60efbcdb..., checked on the host as H3)
SCRIPT=${1:-$REPO/deploy/setup-server.sh}                       # another copy of the script may be tested (e.g. an older one)
OUT=$(mktemp -d "${TMPDIR:-/tmp}/setup-test.XXXXXX")
PASS=0 FAIL=0 LAST="" SHOWN=""
# a file's permission bits as digits, with GNU stat (-c) or BSD stat (-f)
mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
# replace the status the fake Caddy gives for one site (no `sed -i`: its argument differs between GNU and BSD)
set_site_code() { sed "s#^$2 .*#$2 $3#" "$1" >"$1.new" && mv "$1.new" "$1"; }

# ------------------------------------------------------------------------------------------------ the fake host
make_host() {   # $1: root folder
  local R=$1
  mkdir -p "$R/etc/caddy/managed-sites" "$R/etc/systemd/system" "$R/run/lock" "$R/var/lib" "$R/var/backups" "$R/opt" "$R/state" \
    "$R/srv/rigtwin/releases/20261123T223434Z-66c7bbd/asset"
  ln -s "$R/srv/rigtwin/releases/20261123T223434Z-66c7bbd" "$R/srv/rigtwin/current"
  cat >"$R/etc/caddy/Caddyfile" <<'EOF'
{
	email admin@example.org
}

(common) {
	header -Server
}

a.example.org, b.example.org {
	import common
	respond "hi" # a comment with { a brace
}

http://plain.example.org:8080 {
	respond "plain"
}

*.wild.example.org {
	respond "wild"
}

:9000 {
	respond "port only"
}

import /etc/caddy/managed-sites/*.caddy
EOF
  printf 'app.example.net {\n\treverse_proxy 127.0.0.1:3000 {\n\t\tflush_interval -1\n\t}\n}\n' >"$R/etc/caddy/managed-sites/other-app.caddy"
  cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" >"$R/etc/caddy/managed-sites/mightwork-apex.caddy"
  cp "$R/etc/caddy/managed-sites/mightwork-apex.caddy" "$R/state/caddy-running.caddy"
  printf '%s\n' "https://a.example.org/ 200" "https://b.example.org/ 303" "http://plain.example.org:8080/ 200" \
    "https://app.example.net/ 302" "https://mightwork.ai/ 404" >"$R/state/site-codes"
  echo "enabled active" >"$R/state/unit-caddy"
  # a stand-in for the Bun release zip
  mkdir -p "$R/zipsrc/bun-linux-x64" "$R/zipsrc/bun-linux-aarch64"
  printf '#!/bin/sh\necho 1.4.0\n' >"$R/zipsrc/bun-linux-x64/bun"; chmod +x "$R/zipsrc/bun-linux-x64/bun"
  cp "$R/zipsrc/bun-linux-x64/bun" "$R/zipsrc/bun-linux-aarch64/bun"
  (cd "$R/zipsrc" && zip -qr ../bun-linux-x64.zip bun-linux-x64 && zip -qr ../bun-linux-aarch64.zip bun-linux-aarch64)
}

# ------------------------------------------------------------------------------------------------ stand-ins (defined after sourcing)
install_stubs() {
  local R=$HOST
  log() { printf '%s\n' "$*" >>"$HOST/state/calls"; }
  id() {
    case "${1:-}" in
      -u) if [[ -n "${2:-}" ]]; then [[ -e "$HOST/state/user-$2" ]] && echo 999 || return 1; else echo "${FAKE_UID:-0}"; fi ;;
      -un) echo root ;;
      *) [[ -e "$HOST/state/user-$1" ]] && echo "uid=999($1) gid=999($1) groups=999($1)" || return 1 ;;
    esac
  }
  uname() { case "$1" in -s) echo Linux ;; -m) echo "${FAKE_ARCH:-x86_64}" ;; esac; }
  host_is_systemd_linux() { true; }
  cpu_has_avx2() { [[ "${FAKE_AVX2:-yes}" == yes ]]; }
  port_listeners() { printf '%s' "${FAKE_PORT_LISTENER:-}"; }
  owner_mode() { printf '%s %s' "$(cat "$HOST/state/owner$(echo "$1" | tr / _)" 2>/dev/null || echo root:root)" "$(mode_of "$1")"; }
  chown() { log "chown $*"; echo "$1" >"$HOST/state/owner$(echo "$2" | tr / _)"; }
  useradd() { log "useradd $*"; touch "$HOST/state/user-${!#}"; }
  userdel() { log "userdel $*"; rm -f "$HOST/state/user-$1"; }
  logger() { printf '%s\n' "$*" >>"$HOST/state/syslog"; }
  journalctl() { echo "(journal lines)"; }
  keep_owner_mode() { log "keep_owner_mode $1"; echo "-m 644"; }   # the host's GNU stat; here the mode only
  systemd-run() { log "systemd-run $*"; if [[ -n "${PROBE_FAILS:-}" ]]; then echo "serve ok"; echo 'srv ["rigtwin","other-site"]'; echo 'opt ["rigtwin"]'; echo 'varlib ["rigtwin"]'; echo "write ok"; echo "EGRESS OPEN"; elif [[ -n "${PROBE_SEES_VARLIB:-}" ]]; then echo "serve ok"; echo 'srv ["rigtwin"]'; echo 'opt ["rigtwin"]'; echo 'varlib ["other-data","rigtwin"]'; echo "write ok"; echo "egress blocked"; else echo "serve ok"; echo 'srv ["rigtwin"]'; echo 'opt ["rigtwin"]'; echo 'varlib ["rigtwin"]'; echo "write ok"; echo "egress blocked"; fi; }
  flock() { log "flock $*"; }
  ss() { :; }
  sleep() {   # the script sleeps once, right after the reload: the moment to cut it off
    [[ -n "${HUP_AFTER_RELOAD:-}${HUP_AND_CLOSE:-}" ]] && { [[ -n "${HUP_AND_CLOSE:-}" ]] && exec 1>&- 2>&-; kill -HUP "$SELF"; }
    [[ -n "${CLOSE_OUTPUT_AFTER_RELOAD:-}" ]] && exec 1>&- 2>&-
    :
  }
  systemd-analyze() { log "systemd-analyze $*"; [[ -z "${FAIL_VERIFY:-}" ]] || { echo "bad unit"; return 1; }; }
  caddy() {
    case "$1" in
      version) echo "v2.11.4 h1:fake" ;;
      validate)
        local cfg=${!#}; log "caddy validate $cfg"
        [[ -n "${FAIL_VALIDATE_FULL:-}" && "$cfg" == "$CADDY_MAIN" ]] && grep -q 'rigtwin/api' "$SITE_FILE" && { echo "Error: adapting config: fake failure"; return 1; }
        [[ -f "$cfg" ]] ;;
    esac
  }
  unit_file() { echo "$HOST/state/unit-$1"; }
  systemctl() {
    local a=() x; for x in "$@"; do [[ "$x" == --now ]] || a+=("$x"); done
    case "${a[0]}" in
      --version) echo "systemd 255 (255.4-1ubuntu8)" ;;
      cat) echo "ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force" ;;
      is-enabled) [[ -f "$(unit_file "${a[1]}")" ]] && cut -d' ' -f1 "$(unit_file "${a[1]}")" || return 1 ;;
      is-active) if [[ -f "$(unit_file "${a[1]}")" ]]; then cut -d' ' -f2 "$(unit_file "${a[1]}")"; else echo inactive; return 3; fi ;;
      show) [[ "$(systemctl is-active "${!#}" 2>/dev/null)" == active ]] && echo 4242 || echo 0 ;;
      reload)
        log "systemctl reload ${a[1]}"
        [[ -z "${FAIL_RELOAD:-}" ]] || return 1
        cp "$SITE_FILE" "$HOST/state/caddy-running.caddy"
        if [[ -n "${BREAK_OTHER_SITE:-}" ]] && grep -q 'rigtwin/api' "$SITE_FILE"; then set_site_code "$HOST/state/site-codes" https://app.example.net/ 502; fi
        if ! grep -q 'rigtwin/api' "$SITE_FILE"; then set_site_code "$HOST/state/site-codes" https://app.example.net/ 302; fi ;;
      daemon-reload | reset-failed) log "systemctl ${a[*]}" ;;
      enable) log "systemctl enable ${a[1]}"; echo "enabled $(cut -d' ' -f2 "$(unit_file "${a[1]}")" 2>/dev/null || echo inactive)" >"$(unit_file "${a[1]}")" ;;
      restart | start) log "systemctl ${a[*]}"; local st=activating; [[ -e "$SRV_DIR/current/server/server.js" ]] && st=active
        echo "$(systemctl is-enabled "${a[1]}" 2>/dev/null || echo disabled) $st" >"$(unit_file "${a[1]}")" ;;
      disable) log "systemctl disable --now ${a[1]}"; rm -f "$(unit_file "${a[1]}")" ;;
      *) log "systemctl (unexpected) $*"; return 1 ;;
    esac
  }
  curl() {
    local out="" fmt="" url="" x
    while [[ $# -gt 0 ]]; do
      case "$1" in -o) out=$2; shift ;; -w) fmt=$2; shift ;; --max-time | --proto) shift ;; -*) ;; *) url=$1 ;; esac; shift
    done
    if [[ -n "$out" && "$out" != /dev/null ]]; then
      log "curl download $url"
      [[ -z "${FAIL_DOWNLOAD:-}" ]] || return 22
      cp "$HOST/$(basename "$url")" "$out"; return
    fi
    local code=000 running="$HOST/state/caddy-running.caddy" svc
    svc=$(cut -d' ' -f2 "$HOST/state/unit-rigtwin-server" 2>/dev/null || echo inactive)
    case "$url" in
      https://mightwork.ai/rigtwin/) code=200 ;;
      https://mightwork.ai/rigtwin/api/health) if grep -q 'handle /rigtwin/api/\*' "$running"; then [[ "$svc" == active ]] && code=200 || code=502; else code=404; fi ;;
      https://mightwork.ai/rigtwin/server/server.js) if grep -q 'handle /rigtwin/server/\*' "$running" || [[ ! -e "$SRV_DIR/current/server/server.js" ]]; then code=404; else code=200; fi ;;
      http://127.0.0.1:4190/api/health) [[ "$svc" == active ]] && code=200 ;;
      *) x=$(grep "^$url " "$HOST/state/site-codes" | cut -d' ' -f2); code=${x:-000} ;;
    esac
    [[ -n "$fmt" ]] && printf '%s' "$code"
    [[ "$code" != 000 ]]
  }
}

# ------------------------------------------------------------------------------------------------ running a scenario
run() {   # $1 name, $2 host folder, rest: arguments of the script; environment variables pass through
  local name=$1 R=$2; shift 2
  LAST=$name
  scenario "$name" "$R" "$@" >"$OUT/$name.log" 2>&1
  echo $? >"$OUT/$name.rc"
}
# run, but with the output going through a pipe whose reader stops after the first lines (a `| tee` or an SSH session gone)
run_piped() {
  local name=$1 R=$2; shift 2
  LAST=$name
  { scenario "$name" "$R" "$@" 2>&1; echo $? >"$OUT/$name.rc"; } | { head -c 400 >"$OUT/$name.log"; }
}
scenario() {
  local name=$1 R=$2; shift 2
  (
    HOST=$R
    SELF=$(exec sh -c 'echo $PPID')       # this subshell's own process (bash 3.2 has no BASHPID)
    # shellcheck disable=SC1090
    source "$SCRIPT"
    CADDY_MAIN=$R/etc/caddy/Caddyfile CADDY_SITES=$R/etc/caddy/managed-sites SITE_FILE=$R/etc/caddy/managed-sites/mightwork-apex.caddy
    CADDY_LOCK=$R/run/lock/caddy-config.lock BACKUP_DIR=$R/var/backups/rigtwin-setup FIRST_BACKUP=$R/var/backups/rigtwin-setup/mightwork-apex.caddy.before-setup
    UNIT_FILE=$R/etc/systemd/system/rigtwin-server.service DATA_DIR=$R/var/lib/rigtwin SRV_DIR=$R/srv/rigtwin OPT_DIR=$R/opt/rigtwin RUNTIME_DIR=$R/opt/rigtwin/runtime
    LOG=$R/state/setup.log
    BUN_URL_BASE=https://github.com/oven-sh/bun/releases/download/bun-v1.4.0
    if [[ -z "${REAL_SHA:-}" ]]; then
      BUN_SHA256_X64=$(shasum -a 256 "$R/bun-linux-x64.zip" | cut -d' ' -f1)
      BUN_SHA256_AARCH64=$(shasum -a 256 "$R/bun-linux-aarch64.zip" | cut -d' ' -f1)
    fi
    install_stubs
    main "$@"
  )
}
tree_sum() { (cd "$1" && find . -path ./state -prune -o -print | sort && find . -path ./state -prune -o -type f -print0 | sort -z | xargs -0 shasum) | shasum | cut -d' ' -f1; }
ok() { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
no() {
  FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"
  # once per run: how it ended (exit code and the last lines it printed), so that a failure seen only in a CI log can be read
  if [[ -n "$LAST" && "$SHOWN" != *" $LAST "* ]]; then
    SHOWN="$SHOWN $LAST "
    printf '        log> run "%s" ended with exit code %s; its last lines:\n' "$LAST" "$(cat "$OUT/$LAST.rc" 2>/dev/null || echo '?')"
    tail -n 12 "$OUT/$LAST.log" 2>/dev/null | cut -c1-300 | while IFS= read -r l; do printf '        log> %s\n' "$l"; done
  fi
}
expect() { if eval "$2"; then ok "$1"; else no "$1"; fi; }   # $1 description, $2 a test expression
rc() { cat "$OUT/$1.rc"; }
has() { grep -q -- "$2" "$OUT/$1.log"; }
called() { grep -q -- "$2" "$1/state/calls" 2>/dev/null; }
line_of() { grep -n -- "$2" "$1/state/calls" | head -1 | cut -d: -f1; }

new_host() { local R; R=$(mktemp -d "$OUT/host.XXXX"); make_host "$R"; echo "$R"; }
NEW_SITE_REPO="$REPO/deploy/mightwork-apex.caddy"

echo "setup-server.sh test: $SCRIPT"
echo "logs: $OUT"

echo "1. --check on a host before the setup"
H=$(new_host); before=$(tree_sum "$H")
run check-fresh "$H" --check
expect "exit 0" '[[ $(rc check-fresh) == 0 ]]'
expect "says it changed nothing" 'has check-fresh "nothing was changed"'
expect "nothing changed in the fake host" '[[ $(tree_sum "$H") == "$before" ]]'
expect "no changing call (only validate/verify)" '! grep -vqE "^(caddy validate|systemd-analyze verify)" "$H/state/calls" 2>/dev/null'
expect "would create the user, install Bun, change the site, install the unit" 'has check-fresh "would: create the system user" && has check-fresh "would: download https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-linux-x64.zip" && has check-fresh "would: back up" && has check-fresh "would: install .*rigtwin-server.service"'
expect "lists exactly the five reachable sites" '[[ $(grep -c "^    site " "$OUT/check-fresh.log") == 5 ]] && has check-fresh "site http://plain.example.org:8080/ 200" && has check-fresh "site https://a.example.org/ 200" && has check-fresh "site https://app.example.net/ 302" && ! has check-fresh "wild" && ! has check-fresh ":9000"'
expect "shows the Caddy change as a diff" 'has check-fresh "+	handle /rigtwin/api/\*"'

echo "2. --apply on that host"
run apply-1 "$H" --apply
expect "exit 0" '[[ $(rc apply-1) == 0 ]]'
expect "user created" 'called "$H" "useradd --system --user-group --no-create-home --home-dir /nonexistent --shell"'
expect "data folder rigtwin:rigtwin 700" '[[ "$(cat "$H/state/owner$(echo "$H/var/lib/rigtwin" | tr / _)")" == rigtwin:rigtwin && "$(mode_of "$H/var/lib/rigtwin")" == 700 ]]'
expect "Bun installed, executable" '[[ -x "$H/opt/rigtwin/runtime/bun" && "$("$H/opt/rigtwin/runtime/bun" --version)" == 1.4.0 ]]'
expect "site file is the new one" 'cmp -s "$H/etc/caddy/managed-sites/mightwork-apex.caddy" "$NEW_SITE_REPO"'
expect "before-setup copy equals the old file" 'cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/var/backups/rigtwin-setup/mightwork-apex.caddy.before-setup"'
expect "one timestamped backup" '[[ $(ls "$H/var/backups/rigtwin-setup" | grep -c "caddy\.2") == 1 ]]'
expect "Caddy lock taken" 'called "$H" "flock -w 60 9"'
expect "full configuration validated before the reload" '[[ $(line_of "$H" "caddy validate .*/etc/caddy/Caddyfile") -lt $(line_of "$H" "systemctl reload caddy") ]]'
expect "unit installed, enabled, started" 'cmp -s "$H/etc/systemd/system/rigtwin-server.service" "$REPO/deploy/rigtwin-server.service" && called "$H" "systemctl enable rigtwin-server" && called "$H" "systemctl restart rigtwin-server"'
expect "order: user, Bun, Caddy, unit" '[[ $(line_of "$H" "^useradd") -lt $(line_of "$H" "^curl download") && $(line_of "$H" "^curl download") -lt $(line_of "$H" "^systemctl reload caddy") && $(line_of "$H" "^systemctl reload caddy") -lt $(line_of "$H" "^systemctl enable rigtwin-server") ]]'
expect "new route seen: api/health 502 while the service has no release" 'has apply-1 "ok: https://mightwork.ai/rigtwin/api/health answers 502"'
expect "other sites the same" 'has apply-1 "every site and Caddy itself: the same status as before"'
expect "says the service waits for a release with server/" 'has apply-1 "retries every 2 s"'
expect "changes in the system log" 'grep -q "installed Bun" "$H/state/syslog" && grep -q "reloaded caddy" "$H/state/syslog"'

echo "3. --apply again (idempotent)"
cp "$H/state/calls" "$H/state/calls.1"; after1=$(tree_sum "$H")
run apply-2 "$H" --apply
expect "exit 0" '[[ $(rc apply-2) == 0 ]]'
expect "no new call that changes anything" '! diff "$H/state/calls.1" "$H/state/calls" | grep "^>" | grep -vqE "caddy validate|systemd-analyze"'
expect "the fake host is unchanged" '[[ $(tree_sum "$H") == "$after1" ]]'
expect "every step says ok" '[[ $(grep -c "  ok: " "$OUT/apply-2.log") -ge 5 ]]'

echo "4. --check after the setup"
run check-after "$H" --check
expect "exit 0, nothing to do" '[[ $(rc check-after) == 0 ]] && ! has check-after "would:"'

echo "5. a release with server/ goes live; --apply sees the service answer"
mkdir -p "$H/srv/rigtwin/current/server"; touch "$H/srv/rigtwin/current/server/server.js"
echo "enabled active" >"$H/state/unit-rigtwin-server"
run apply-3 "$H" --apply
expect "exit 0, service answers" '[[ $(rc apply-3) == 0 ]] && has apply-3 "ok: the service answers"'

echo "6. --undo while the live release contains server/ is refused as a whole (security review S6)"
run undo-kept "$H" --undo
expect "exit 1, says why" '[[ $(rc undo-kept) == 1 ]] && has undo-kept "the live release contains server/"'
expect "nothing changed: unit, route and runtime kept" '[[ -e "$H/etc/systemd/system/rigtwin-server.service" && -e "$H/opt/rigtwin/runtime/bun" ]] && cmp -s "$H/etc/caddy/managed-sites/mightwork-apex.caddy" "$NEW_SITE_REPO" && ! called "$H" "systemctl disable"'

echo "7. --undo after switching to a release without server/"
rm -rf "$H/srv/rigtwin/current/server"
cp "$H/etc/caddy/managed-sites/mightwork-apex.caddy" "$H/state/site.keep"; printf '# changed by someone else\n' >>"$H/etc/caddy/managed-sites/mightwork-apex.caddy"
run undo-changed "$H" --undo
expect "a site file changed by someone else since: left as it is, the difference shown (S6)" '[[ $(rc undo-changed) == 1 ]] && has undo-changed "someone has changed it since" && grep -q "changed by someone else" "$H/etc/caddy/managed-sites/mightwork-apex.caddy"'
cp "$H/state/site.keep" "$H/etc/caddy/managed-sites/mightwork-apex.caddy"
run undo "$H" --undo
expect "exit 0" '[[ $(rc undo) == 0 ]]'
expect "site file as before the setup" 'cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/etc/caddy/managed-sites/mightwork-apex.caddy"'
expect "old route answers again (api/health 404)" 'has undo "ok: https://mightwork.ai/rigtwin/api/health answers 404"'

expect "runtime removed, data and user kept" '[[ ! -e "$H/opt/rigtwin" && -d "$H/var/lib/rigtwin" && -e "$H/state/user-rigtwin" ]]'

echo "8. --undo --purge-data"
run purge "$H" --undo --purge-data
expect "exit 0, data folder and user gone" '[[ $(rc purge) == 0 && ! -e "$H/var/lib/rigtwin" && ! -e "$H/state/user-rigtwin" ]] && called "$H" "userdel rigtwin"'
run purge-check "$H" --check
expect "a --check afterwards would set everything up again" 'has purge-check "would: create the system user" && has purge-check "would: back up"'

echo "9. the whole Caddy configuration fails to validate"
H=$(new_host)
FAIL_VALIDATE_FULL=1 run validate-fails "$H" --apply
expect "exit 1, loud" '[[ $(rc validate-fails) == 1 ]] && has validate-fails "STOPPED: the whole Caddy configuration does not validate"'
expect "old site file back, no reload with the new one" 'cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/etc/caddy/managed-sites/mightwork-apex.caddy" && cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/state/caddy-running.caddy"'
expect "unit not installed" '[[ ! -e "$H/etc/systemd/system/rigtwin-server.service" ]]'

echo "10. the reload fails"
H=$(new_host)
FAIL_RELOAD=1 run reload-fails "$H" --apply
expect "exit 1, old file back" '[[ $(rc reload-fails) == 1 ]] && cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/etc/caddy/managed-sites/mightwork-apex.caddy" && has reload-fails "the previous one was put back"'

echo "11. another site answers differently after the reload"
H=$(new_host)
BREAK_OTHER_SITE=1 run other-site "$H" --apply
expect "exit 1, loud difference naming the site" '[[ $(rc other-site) == 1 ]] && has other-site "DIFFERENCE: a site or Caddy itself" && has other-site "> site https://app.example.net/ 502"'
expect "old site file back and reloaded" 'cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/state/caddy-running.caddy" && has other-site "restored: "'
expect "unit not installed" '[[ ! -e "$H/etc/systemd/system/rigtwin-server.service" ]]'

echo "12. the downloaded zip does not match the pinned SHA-256"
H=$(new_host)
REAL_SHA=1 run sha-mismatch "$H" --apply
expect "exit 1, nothing installed, Caddy untouched" '[[ $(rc sha-mismatch) == 1 && ! -e "$H/opt/rigtwin/runtime/bun" ]] && has sha-mismatch "but 2d03fb5fb83ac8b5.* is pinned" && ! called "$H" "systemctl reload"'

echo "13. aarch64 and x64 without AVX2 pick their own zip"
H=$(new_host)
FAKE_ARCH=aarch64 run arm "$H" --apply
expect "aarch64 zip installed" '[[ $(rc arm) == 0 ]] && called "$H" "curl download .*/bun-linux-aarch64.zip"'
H=$(new_host)
FAKE_AVX2=no run baseline "$H" --check
expect "x64 without AVX2: baseline zip" 'has baseline "bun-linux-x64-baseline.zip, check SHA-256 184fb4595f0d401a"'
FAKE_ARCH=riscv64 run riscv "$H" --check
expect "other machines refused" '[[ $(rc riscv) == 1 ]] && has riscv "no Bun build for this machine"'

echo "14. refusals"
H=$(new_host)
FAKE_UID=1000 run not-root "$H" --apply
expect "not root: refused, nothing called" '[[ $(rc not-root) == 1 ]] && has not-root "run this as root" && [[ ! -e "$H/state/calls" ]]'
FAKE_PORT_LISTENER='LISTEN 0 511 127.0.0.1:4190 0.0.0.0:* users:(("node",pid=77,fd=3))' run port-used "$H" --apply
expect "port 4190 used by another program: refused" '[[ $(rc port-used) == 1 ]] && has port-used "port 4190 is in use"'
rm "$H/etc/caddy/managed-sites/mightwork-apex.caddy"
run wrong-host "$H" --check
expect "a host without the rigtwin site: refused" '[[ $(rc wrong-host) == 1 ]] && has wrong-host "not the host that serves"'
run bad-args "$H" --apply --purge-data
expect "--purge-data without --undo: refused" '[[ $(rc bad-args) != 0 ]]'
run no-args "$H"
expect "no mode: usage" '[[ $(rc no-args) == 2 ]] && has no-args "setup-server.sh --check"'

echo "15. systemd-analyze rejects the unit"
H=$(new_host)
FAIL_VERIFY=1 run verify-fails "$H" --apply
expect "exit 1, unit not installed, Caddy change kept (it passed its checks)" '[[ $(rc verify-fails) == 1 && ! -e "$H/etc/systemd/system/rigtwin-server.service" ]] && cmp -s "$H/etc/caddy/managed-sites/mightwork-apex.caddy" "$NEW_SITE_REPO"'

echo "16a. the session drops for real: hang-up and the output gone at once"
H=$(new_host)
HUP_AND_CLOSE=1 run hup-closed "$H" --apply
expect "old site file back, Caddy runs it" 'cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/etc/caddy/managed-sites/mightwork-apex.caddy" && cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/state/caddy-running.caddy"'
expect "the log file has the run (the output was gone)" 'grep -q "setup-server.sh --apply" "$H/state/setup.log" && grep -q "previous one was put back" "$H/state/setup.log"'

echo "16. the SSH session drops (SIGHUP) right after the reload: the backup is put back and Caddy reloaded (security review M1)"
H=$(new_host)
HUP_AFTER_RELOAD=1 run hup "$H" --apply
expect "stopped, old site file back" '[[ $(rc hup) != 0 ]] && cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/etc/caddy/managed-sites/mightwork-apex.caddy"'
expect "and Caddy runs the old file again" 'cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/state/caddy-running.caddy"'

echo "17. the script's output is closed right after the reload: the backup is still put back"
H=$(new_host)
CLOSE_OUTPUT_AFTER_RELOAD=1 run closed "$H" --apply
expect "old site file back" 'cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/etc/caddy/managed-sites/mightwork-apex.caddy"'
expect "and Caddy runs the old file again" 'cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/state/caddy-running.caddy"'
expect "the restore is in the system log" 'grep -q "restored" "$H/state/syslog"'

echo "18. the reader of the output (| tee, a dropped session) goes away early: the backup is still put back"
H=$(new_host)
BREAK_OTHER_SITE=1 run_piped piped "$H" --apply
expect "old site file back" 'cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/etc/caddy/managed-sites/mightwork-apex.caddy"'
expect "and Caddy runs the old file again" 'cat "$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy" | cmp -s - "$H/state/caddy-running.caddy"'

echo "19. the installed runtime is checked by its recorded SHA-256, the site file keeps its owner and mode (S6)"
H=$(new_host)
run apply-hash "$H" --apply
expect "bun.sha256 records the zip and the binary" 'grep -q "^zip bun-linux-x64.zip " "$H/opt/rigtwin/runtime/bun.sha256" && grep -q "^bun " "$H/opt/rigtwin/runtime/bun.sha256"'
expect "the site file was installed with the old file's owner and mode" 'called "$H" "keep_owner_mode .*mightwork-apex.caddy"'
run check-hash "$H" --check
expect "--check: the binary is the recorded one" 'has check-hash "the binary is the one installed from bun-linux-x64.zip"'
printf '#!/bin/sh\necho 1.4.0\n# changed\n' >"$H/opt/rigtwin/runtime/bun"
run check-tampered "$H" --check
expect "--check: a changed binary is reported loudly" 'has check-tampered "its SHA-256 is not the one recorded"'
expect "--check prints the host checks H1 to H13" 'for h in H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 H11 H12 H13; do has check-hash "  $h " || exit 1; done'

echo "20. --probe runs Bun once under the unit's own settings (host check H7)"
run probe "$H" --probe
expect "exit 0, passed" '[[ $(rc probe) == 0 ]] && has probe "probe passed"'
expect "with the unit's hardening as systemd-run properties" 'called "$H" "systemd-run .*-p ProtectSystem=strict .*-p IPAddressDeny=any .*-p MemoryMax=512M"'
expect "but not how the service starts" '! called "$H" "systemd-run .*-p ExecStart=" && ! called "$H" "systemd-run .*-p Restart="'
PROBE_FAILS=1 run probe-fails "$H" --probe
expect "a probe that sees other sites or the internet fails loudly" '[[ $(rc probe-fails) == 1 ]] && has probe-fails "do not merge yet"'
PROBE_SEES_VARLIB=1 run probe-varlib "$H" --probe
expect "a probe that sees another program's data folder under /var/lib fails loudly" '[[ $(rc probe-varlib) == 1 ]] && has probe-varlib "do not merge yet"'
expect "the unit names no path of another program (only rigtwin's own, and the host's Caddy, web root and backups)" '! grep -E "^(InaccessiblePaths|BindPaths|BindReadOnlyPaths|ReadWritePaths|TemporaryFileSystem)=" "$REPO/deploy/rigtwin-server.service" | tr " " "\n" | sed "s/^[A-Za-z]*=//" | grep -vE "^-?/(srv|opt|var/lib)(/rigtwin)?(:ro)?$|^-/etc/caddy$|^-/var/www$|^-/var/backups$" | grep -q .'

echo
echo "setup-server.sh test: $PASS passed, $FAIL failed (logs in $OUT)"
[[ $FAIL == 0 ]]
