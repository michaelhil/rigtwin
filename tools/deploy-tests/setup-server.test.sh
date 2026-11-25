#!/bin/bash
# Local test of deploy/setup-server.sh. Runs the real script against a fake host folder, with
# the host's system commands (systemctl, caddy, curl, useradd, ...) stood in by shell functions that record what
# was asked of them and emulate Caddy's routing from the site file it last "reloaded".
#
#   bash tools/deploy-tests/setup-server.test.sh [path/to/setup-server.sh]
#
# Each scenario runs in its own subshell and fake root; the output of every run is kept in $OUT for reading, and the
# end of a run's output is printed below its first failed expectation (lines "log> ...", which `bun run check` shows).
# The harness must run with BSD tools (macOS) and GNU tools (the CI's Ubuntu) alike: no `stat -f`, no `sed -i ''`.
set -uo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)     # the repository of this test (the apex file live before the retirement is the stand-in tools/deploy-tests/fixtures/mightwork-apex.before-retire.caddy)
APEX_BEFORE=$REPO/tools/deploy-tests/fixtures/mightwork-apex.before-retire.caddy
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
  mkdir -p "$R/etc/caddy/managed-sites" "$R/etc/systemd/system" "$R/run/lock" "$R/var/lib" "$R/var/backups" "$R/opt" "$R/state" "$R/usr/local/bin" \
    "$R/srv/legacy"
  # the public keys that may deploy (stand-ins; the real file is made on the laptop and is not in the repository)
  printf '%s\n' "# the owner's key" "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOwnerKeyOwnerKeyOwnerKeyOwnerKeyOwnerKey1234 owner" \
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIActionsKeyActionsKeyActionsKeyActionsKey5678 actions" >"$R/synergon-deploy.keys"
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
  cat "$APEX_BEFORE" >"$R/etc/caddy/managed-sites/mightwork-apex.caddy"
  cp "$R/etc/caddy/managed-sites/mightwork-apex.caddy" "$R/state/caddy-running.apex"
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
  usermod() { log "usermod $*"; }
  userdel() { log "userdel $*"; rm -f "$HOST/state/user-$1"; }
  logger() { printf '%s\n' "$*" >>"$HOST/state/syslog"; }
  journalctl() { echo "(journal lines)"; }
  keep_owner_mode() { log "keep_owner_mode $1"; echo "-m 644"; }   # the host's GNU stat; here the mode only
  systemd-run() { log "systemd-run $*"; if [[ -n "${PROBE_FAILS:-}" ]]; then echo "serve ok"; echo 'srv ["synergon","other-site"]'; echo 'opt ["synergon"]'; echo 'varlib ["synergon"]'; echo "write ok"; echo "EGRESS OPEN"; elif [[ -n "${PROBE_SEES_VARLIB:-}" ]]; then echo "serve ok"; echo 'srv ["synergon"]'; echo 'opt ["synergon"]'; echo 'varlib ["other-data","synergon"]'; echo "write ok"; echo "egress blocked"; else echo "serve ok"; echo 'srv ["synergon"]'; echo 'opt ["synergon"]'; echo 'varlib ["synergon"]'; echo "write ok"; echo "egress blocked"; fi; }
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
        [[ -n "${FAIL_VALIDATE_FULL:-}" && "$cfg" == "$CADDY_MAIN" ]] && { [[ -e "$SITE_FILE" ]] && grep -q 'handle /api/' "$SITE_FILE" || ! cmp -s "$APEX_FILE" "$APEX_BEFORE"; } && { echo "Error: adapting config: fake failure"; return 1; }
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
        if [[ -e "$SITE_FILE" ]]; then cp "$SITE_FILE" "$HOST/state/caddy-running.synergon"; else rm -f "$HOST/state/caddy-running.synergon"; fi
        cp "$APEX_FILE" "$HOST/state/caddy-running.apex"
        # BREAK_OTHER_SITE=apply: another site breaks while the new site file is installed; =apex: while the apex file is changed
        if [[ "${BREAK_OTHER_SITE:-}" == apply ]]; then if [[ -e "$SITE_FILE" ]]; then set_site_code "$HOST/state/site-codes" https://app.example.net/ 502; else set_site_code "$HOST/state/site-codes" https://app.example.net/ 302; fi; fi
        if [[ "${BREAK_OTHER_SITE:-}" == apex ]]; then if cmp -s "$APEX_FILE" "$APEX_BEFORE"; then set_site_code "$HOST/state/site-codes" https://app.example.net/ 302; else set_site_code "$HOST/state/site-codes" https://app.example.net/ 502; fi; fi ;;
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
    local code=000 running="$HOST/state/caddy-running.synergon" svc
    svc=$(cut -d' ' -f2 "$HOST/state/unit-synergon-server" 2>/dev/null || echo inactive)
    case "$url" in
      # the new site: no site block, no answer (000: no certificate); the block without a release: 404 for the files
      https://synergon.mightwork.ai/) if [[ -e "$running" ]]; then [[ -e "$SRV_DIR/current" ]] && code=200 || code=404; fi ;;
      https://synergon.mightwork.ai/api/health) if [[ -e "$running" ]]; then if grep -q 'handle /api/\*' "$running"; then [[ "$svc" == active ]] && code=200 || code=502; else code=404; fi; fi ;;
      https://synergon.mightwork.ai/server/server.js) if [[ -e "$running" ]]; then if grep -q 'handle /server/\*' "$running" || [[ ! -e "$SRV_DIR/current/server/server.js" ]]; then code=404; else code=200; fi; fi ;;
      https://mightwork.ai/*) code=404 ;;
      http://127.0.0.1:4191/api/health) [[ "$svc" == active ]] && code=200 ;;
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
    CADDY_MAIN=$R/etc/caddy/Caddyfile CADDY_SITES=$R/etc/caddy/managed-sites SITE_FILE=$R/etc/caddy/managed-sites/synergon.caddy APEX_FILE=$R/etc/caddy/managed-sites/mightwork-apex.caddy
    CADDY_LOCK=$R/run/lock/caddy-config.lock BACKUP_DIR=$R/var/backups/synergon-setup FIRST_BACKUP=$R/var/backups/synergon-setup/mightwork-apex.caddy.before-retire
    KEYS_FILE=$R/synergon-deploy.keys DEPLOY_HOME=$R/var/lib/synergon-deploy GATE_FILE=$R/usr/local/bin/synergon-deploy-gate
    UNIT_FILE=$R/etc/systemd/system/synergon-server.service DATA_DIR=$R/var/lib/synergon SRV_DIR=$R/srv/synergon OPT_DIR=$R/opt/synergon RUNTIME_DIR=$R/opt/synergon/runtime
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
NEW_SITE_REPO="$REPO/deploy/synergon.caddy"
NEW_APEX_REPO="$REPO/deploy/mightwork-apex.caddy"

echo "setup-server.sh test: $SCRIPT"
echo "logs: $OUT"

echo "1. --check on a host before the setup"
H=$(new_host); before=$(tree_sum "$H")
run check-fresh "$H" --check
expect "exit 0" '[[ $(rc check-fresh) == 0 ]]'
expect "says it changed nothing" 'has check-fresh "nothing was changed"'
expect "nothing changed in the fake host" '[[ $(tree_sum "$H") == "$before" ]]'
expect "no changing call (only validate/verify)" '! grep -vqE "^(caddy validate|systemd-analyze verify)" "$H/state/calls" 2>/dev/null'
expect "would create both users, the gate, the folder, install Bun, add the site, install the unit" 'has check-fresh "would: create the system user synergon (no login" && has check-fresh "would: create the system user synergon-deploy" && has check-fresh "would: install the gate" && has check-fresh "would: create /.*srv/synergon" && has check-fresh "would: download https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-linux-x64.zip" && has check-fresh "would: install the new site file" && has check-fresh "would: install .*synergon-server.service"'
expect "would write the two keys, limited to the gate" 'has check-fresh "would: write .*authorized_keys.*2 key(s), each .restrict,command="'
expect "lists exactly the five reachable sites" '[[ $(grep -c "^    site " "$OUT/check-fresh.log") == 5 ]] && has check-fresh "site http://plain.example.org:8080/ 200" && has check-fresh "site https://a.example.org/ 200" && has check-fresh "site https://app.example.net/ 302" && ! has check-fresh "wild" && ! has check-fresh ":9000"'
expect "shows the new site file as a diff" 'has check-fresh "+	handle /api/\*" && has check-fresh "+synergon.mightwork.ai {"'
expect "says what --retire-apex would do later" 'has check-fresh "still has routes" && has check-fresh "+	respond \"Not found\" 404"'

echo "2. --apply on that host"
run apply-1 "$H" --apply
expect "exit 0" '[[ $(rc apply-1) == 0 ]]'
expect "user created" 'called "$H" "useradd --system --user-group --no-create-home --home-dir /nonexistent --shell"'
expect "data folder synergon:synergon 700" '[[ "$(cat "$H/state/owner$(echo "$H/var/lib/synergon" | tr / _)")" == synergon:synergon && "$(mode_of "$H/var/lib/synergon")" == 700 ]]'
expect "deploy account created with a shell and no password" 'called "$H" "useradd --system --user-group --no-create-home --home-dir .*synergon-deploy --shell /bin/bash synergon-deploy" && called "$H" "usermod -p \* synergon-deploy"'
expect "authorized_keys: both keys, each limited to the gate, nothing else" '[[ $(grep -c "^restrict,command=\"$H/usr/local/bin/synergon-deploy-gate\" ssh-ed25519 " "$H/var/lib/synergon-deploy/.ssh/authorized_keys") == 2 && $(wc -l <"$H/var/lib/synergon-deploy/.ssh/authorized_keys" | tr -d " ") == 2 ]] && ! grep -q "owner.s key" "$H/var/lib/synergon-deploy/.ssh/authorized_keys"'
expect "gate installed, executable, the repository's" 'cmp -s "$H/usr/local/bin/synergon-deploy-gate" "$REPO/deploy/synergon-deploy-gate.sh" && [[ -x "$H/usr/local/bin/synergon-deploy-gate" ]]'
expect "/srv/synergon owned by the deploy account, 755" '[[ "$(cat "$H/state/owner$(echo "$H/srv/synergon" | tr / _)")" == synergon-deploy:synergon-deploy && "$(mode_of "$H/srv/synergon")" == 755 ]]'
expect "Bun installed, executable" '[[ -x "$H/opt/synergon/runtime/bun" && "$("$H/opt/synergon/runtime/bun" --version)" == 1.4.0 ]]'
expect "site file is the new one" 'cmp -s "$H/etc/caddy/managed-sites/synergon.caddy" "$NEW_SITE_REPO"'
expect "the apex file is untouched" 'cmp -s "$H/etc/caddy/managed-sites/mightwork-apex.caddy" "$APEX_BEFORE"'
expect "no backup (there was no earlier site file)" '! ls "$H/var/backups/synergon-setup" 2>/dev/null | grep -q "caddy"'
expect "Caddy lock taken" 'called "$H" "flock -w 60 9"'
expect "full configuration validated before the reload" '[[ $(line_of "$H" "caddy validate .*/etc/caddy/Caddyfile") -lt $(line_of "$H" "systemctl reload caddy") ]]'
expect "unit installed, enabled, started" 'cmp -s "$H/etc/systemd/system/synergon-server.service" "$REPO/deploy/synergon-server.service" && called "$H" "systemctl enable synergon-server" && called "$H" "systemctl restart synergon-server"'
expect "order: users, Bun, Caddy, unit" '[[ $(line_of "$H" "^useradd --system --user-group --no-create-home --home-dir /nonexistent") -lt $(line_of "$H" "^useradd .*synergon-deploy") && $(line_of "$H" "^useradd .*synergon-deploy") -lt $(line_of "$H" "^curl download") && $(line_of "$H" "^curl download") -lt $(line_of "$H" "^systemctl reload caddy") && $(line_of "$H" "^systemctl reload caddy") -lt $(line_of "$H" "^systemctl enable synergon-server") ]]'
expect "the new site answers: / 404 until the first release, server/server.js 404" 'has apply-1 "ok: https://synergon.mightwork.ai/ answers 404" && has apply-1 "ok: https://synergon.mightwork.ai/server/server.js answers 404"'
expect "new route seen: api/health 502 while the service has no release" 'has apply-1 "ok: https://synergon.mightwork.ai/api/health answers 502"'
expect "other sites the same (the new host name is not counted as a change)" 'has apply-1 "every site and Caddy itself: the same status as before"'
expect "says the service waits for a release with server/" 'has apply-1 "retries every 2 s"'
expect "changes in the system log" 'grep -q "installed Bun" "$H/state/syslog" && grep -q "reloaded caddy" "$H/state/syslog"'

echo "3. --apply again (idempotent)"
cp "$H/state/calls" "$H/state/calls.1"; after1=$(tree_sum "$H")
run apply-2 "$H" --apply
expect "exit 0" '[[ $(rc apply-2) == 0 ]]'
expect "no new call that changes anything" '! diff "$H/state/calls.1" "$H/state/calls" | grep "^>" | grep -vqE "caddy validate|systemd-analyze"'
expect "the fake host is unchanged" '[[ $(tree_sum "$H") == "$after1" ]]'
expect "every step says ok" '[[ $(grep -c "  ok: " "$OUT/apply-2.log") -ge 8 ]]'
mv "$H/synergon-deploy.keys" "$H/keys.away"
run apply-nokeys "$H" --apply
expect "without the key file, existing keys are kept" '[[ $(rc apply-nokeys) == 0 ]] && has apply-nokeys "keys kept as they are"'
mv "$H/keys.away" "$H/synergon-deploy.keys"

echo "4. --check after the setup"
run check-after "$H" --check
expect "exit 0, nothing to do for the setup" '[[ $(rc check-after) == 0 && $(grep -c "would:" "$OUT/check-after.log") == 0 ]]'

echo "5. a release with server/ goes live; --apply sees the service answer"
mkdir -p "$H/srv/synergon/releases/20261125T120000Z-abc1234/server"; touch "$H/srv/synergon/releases/20261125T120000Z-abc1234/server/server.js"
ln -s "$H/srv/synergon/releases/20261125T120000Z-abc1234" "$H/srv/synergon/current"
echo "enabled active" >"$H/state/unit-synergon-server"
run apply-3 "$H" --apply
expect "exit 0, service answers" '[[ $(rc apply-3) == 0 ]] && has apply-3 "ok: the service answers"'

echo "5b. --retire-apex: mightwork.ai answers 404 for everything"
run retire "$H" --retire-apex
expect "exit 0" '[[ $(rc retire) == 0 ]]'
expect "the apex file is the 404-everything file" 'cmp -s "$H/etc/caddy/managed-sites/mightwork-apex.caddy" "$NEW_APEX_REPO"'
expect "the file from before is kept, and a timestamped backup" 'cmp -s "$APEX_BEFORE" "$H/var/backups/synergon-setup/mightwork-apex.caddy.before-retire" && [[ $(ls "$H/var/backups/synergon-setup" | grep -c "caddy\.2") == 1 ]]'
expect "installed with the old file's owner and mode" 'called "$H" "keep_owner_mode .*mightwork-apex.caddy"'
expect "Synergon's own site was not touched" 'cmp -s "$H/etc/caddy/managed-sites/synergon.caddy" "$NEW_SITE_REPO"'
expect "mightwork.ai checked at three addresses, every other site the same" 'has retire "ok: https://mightwork.ai/ answers 404" && has retire "ok: https://mightwork.ai/anything answers 404" && has retire "every site and Caddy itself: the same status as before"'
run retire-again "$H" --retire-apex
expect "a second run changes nothing" '[[ $(rc retire-again) == 0 ]] && has retire-again "already the file that answers 404"'

echo "5c. --restore-apex puts the file from before back, and --retire-apex goes again"
run restore "$H" --restore-apex
expect "exit 0, file as before" '[[ $(rc restore) == 0 ]] && cmp -s "$H/etc/caddy/managed-sites/mightwork-apex.caddy" "$APEX_BEFORE"'
run retire-2 "$H" --retire-apex
expect "retired again" '[[ $(rc retire-2) == 0 ]] && cmp -s "$H/etc/caddy/managed-sites/mightwork-apex.caddy" "$NEW_APEX_REPO"'

echo "5d. --retire-apex is refused while Synergon is not live"
H5=$(new_host)
run retire-early "$H5" --retire-apex
expect "exit 1, nothing changed, Caddy not reloaded" '[[ $(rc retire-early) == 1 ]] && has retire-early "does not answer 200" && cmp -s "$H5/etc/caddy/managed-sites/mightwork-apex.caddy" "$APEX_BEFORE" && ! called "$H5" "systemctl reload"'
H5=$(new_host)
run apply-pre "$H5" --apply
run retire-no-release "$H5" --retire-apex
expect "set up but no release yet (/ answers 404): refused as well" '[[ $(rc retire-no-release) == 1 ]] && cmp -s "$H5/etc/caddy/managed-sites/mightwork-apex.caddy" "$APEX_BEFORE"'

echo "5e. another site answers differently after the apex change: the old apex file is back"
H5=$(new_host)
run apply-pre2 "$H5" --apply
mkdir -p "$H5/srv/synergon/releases/20261125T120000Z-abc1234/server"; touch "$H5/srv/synergon/releases/20261125T120000Z-abc1234/server/server.js"
ln -s "$H5/srv/synergon/releases/20261125T120000Z-abc1234" "$H5/srv/synergon/current"; echo "enabled active" >"$H5/state/unit-synergon-server"
BREAK_OTHER_SITE=apex run retire-breaks "$H5" --retire-apex
expect "exit 1, loud difference, apex file back and reloaded" '[[ $(rc retire-breaks) == 1 ]] && has retire-breaks "DIFFERENCE: a site or Caddy itself" && cmp -s "$H5/etc/caddy/managed-sites/mightwork-apex.caddy" "$APEX_BEFORE" && cmp -s "$H5/state/caddy-running.apex" "$APEX_BEFORE" && has retire-breaks "restored: "'

echo "6. --undo while the live release contains server/ is refused as a whole (security review S6)"
run undo-kept "$H" --undo
expect "exit 1, says why" '[[ $(rc undo-kept) == 1 ]] && has undo-kept "the live release contains server/"'
expect "nothing changed: unit, route and runtime kept" '[[ -e "$H/etc/systemd/system/synergon-server.service" && -e "$H/opt/synergon/runtime/bun" ]] && cmp -s "$H/etc/caddy/managed-sites/synergon.caddy" "$NEW_SITE_REPO" && ! called "$H" "systemctl disable"'

echo "7. --undo after switching to a release without server/"
rm -rf "$H/srv/synergon/releases/20261125T120000Z-abc1234/server"
cp "$H/etc/caddy/managed-sites/synergon.caddy" "$H/state/site.keep"; printf '# changed by someone else\n' >>"$H/etc/caddy/managed-sites/synergon.caddy"
run undo-changed "$H" --undo
expect "a site file changed by someone else since: left as it is, the difference shown (S6)" '[[ $(rc undo-changed) == 1 ]] && has undo-changed "someone has changed it since" && grep -q "changed by someone else" "$H/etc/caddy/managed-sites/synergon.caddy"'
cp "$H/state/site.keep" "$H/etc/caddy/managed-sites/synergon.caddy"
run undo "$H" --undo
expect "exit 0" '[[ $(rc undo) == 0 ]]'
expect "the site file is gone, Caddy reloaded without it" '[[ ! -e "$H/etc/caddy/managed-sites/synergon.caddy" && ! -e "$H/state/caddy-running.synergon" ]]'
expect "the site no longer answers" 'has undo "ok: https://synergon.mightwork.ai/api/health answers 000"'
expect "the gate and the deploy keys are gone" '[[ ! -e "$H/usr/local/bin/synergon-deploy-gate" && ! -e "$H/var/lib/synergon-deploy/.ssh/authorized_keys" ]]'
expect "runtime removed; data, releases and both users kept" '[[ ! -e "$H/opt/synergon" && -d "$H/var/lib/synergon" && -d "$H/srv/synergon/releases" && -e "$H/state/user-synergon" && -e "$H/state/user-synergon-deploy" ]]'
expect "the apex file was not touched by --undo" 'cmp -s "$H/etc/caddy/managed-sites/mightwork-apex.caddy" "$NEW_APEX_REPO"'

echo "8. --undo --purge-data"
run purge "$H" --undo --purge-data
expect "exit 0, data folder, releases and both users gone" '[[ $(rc purge) == 0 && ! -e "$H/var/lib/synergon" && ! -e "$H/srv/synergon" && ! -e "$H/state/user-synergon" && ! -e "$H/state/user-synergon-deploy" ]] && called "$H" "userdel synergon" && called "$H" "userdel synergon-deploy"'
run purge-check "$H" --check
expect "a --check afterwards would set everything up again" 'has purge-check "would: create the system user synergon (no login" && has purge-check "would: install the new site file"'

echo "9. the whole Caddy configuration fails to validate"
H=$(new_host)
FAIL_VALIDATE_FULL=1 run validate-fails "$H" --apply
expect "exit 1, loud" '[[ $(rc validate-fails) == 1 ]] && has validate-fails "STOPPED: the whole Caddy configuration does not validate"'
expect "the new site file is removed again, Caddy runs without it" '[[ ! -e "$H/etc/caddy/managed-sites/synergon.caddy" && ! -e "$H/state/caddy-running.synergon" ]] && cmp -s "$APEX_BEFORE" "$H/etc/caddy/managed-sites/mightwork-apex.caddy"'
expect "unit not installed" '[[ ! -e "$H/etc/systemd/system/synergon-server.service" ]]'

echo "10. the reload fails"
H=$(new_host)
FAIL_RELOAD=1 run reload-fails "$H" --apply
expect "exit 1, new file removed" '[[ $(rc reload-fails) == 1 && ! -e "$H/etc/caddy/managed-sites/synergon.caddy" ]] && has reload-fails "the previous state was put back"'

echo "11. another site answers differently after the reload"
H=$(new_host)
BREAK_OTHER_SITE=apply run other-site "$H" --apply
expect "exit 1, loud difference naming the site" '[[ $(rc other-site) == 1 ]] && has other-site "DIFFERENCE: a site or Caddy itself" && has other-site "> site https://app.example.net/ 502"'
expect "new site file removed and Caddy reloaded" '[[ ! -e "$H/etc/caddy/managed-sites/synergon.caddy" && ! -e "$H/state/caddy-running.synergon" ]] && has other-site "restored: "'
expect "unit not installed" '[[ ! -e "$H/etc/systemd/system/synergon-server.service" ]]'

echo "12. the downloaded zip does not match the pinned SHA-256"
H=$(new_host)
REAL_SHA=1 run sha-mismatch "$H" --apply
expect "exit 1, nothing installed, Caddy untouched" '[[ $(rc sha-mismatch) == 1 && ! -e "$H/opt/synergon/runtime/bun" ]] && has sha-mismatch "but 2d03fb5fb83ac8b5.* is pinned" && ! called "$H" "systemctl reload"'

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
FAKE_PORT_LISTENER='LISTEN 0 511 127.0.0.1:4191 0.0.0.0:* users:(("node",pid=77,fd=3))' run port-used "$H" --apply
expect "port 4191 used by another program: refused" '[[ $(rc port-used) == 1 ]] && has port-used "port 4191 is in use"'
mv "$H/synergon-deploy.keys" "$H/keys.away"
run no-keys "$H" --apply
expect "no key file and no keys on the host yet: refused, nothing called" '[[ $(rc no-keys) == 1 ]] && has no-keys "synergon-deploy.keys" && ! called "$H" "useradd"'
printf 'not a key\n' >"$H/synergon-deploy.keys"
run bad-key "$H" --apply
expect "a line that is not a public key: refused before a key is written" '[[ $(rc bad-key) == 1 && ! -e "$H/var/lib/synergon-deploy/.ssh/authorized_keys" ]] && has bad-key "not a public key"'
printf 'ssh-ed25519 AAAA" ; touch /tmp/x ; "\n' >"$H/synergon-deploy.keys"
run quote-key "$H" --apply
expect "a key line with a quote in it: refused (no extra option or command can be added)" '[[ $(rc quote-key) == 1 && ! -e "$H/var/lib/synergon-deploy/.ssh/authorized_keys" ]]'
rm "$H/synergon-deploy.keys"
rm "$H/etc/caddy/managed-sites/mightwork-apex.caddy"
run wrong-host "$H" --check
expect "a host without the apex site: refused" '[[ $(rc wrong-host) == 1 ]] && has wrong-host "not the host that serves"'
run bad-args "$H" --apply --purge-data
expect "--purge-data without --undo: refused" '[[ $(rc bad-args) != 0 ]]'
run no-args "$H"
expect "no mode: usage" '[[ $(rc no-args) == 2 ]] && has no-args "setup-server.sh --check" && has no-args "--retire-apex"'

echo "15. systemd-analyze rejects the unit"
H=$(new_host)
FAIL_VERIFY=1 run verify-fails "$H" --apply
expect "exit 1, unit not installed, Caddy change kept (it passed its checks)" '[[ $(rc verify-fails) == 1 && ! -e "$H/etc/systemd/system/synergon-server.service" ]] && cmp -s "$H/etc/caddy/managed-sites/synergon.caddy" "$NEW_SITE_REPO"'

echo "16a. the session drops for real: hang-up and the output gone at once"
H=$(new_host)
HUP_AND_CLOSE=1 run hup-closed "$H" --apply
expect "new site file removed, Caddy runs without it" '[[ ! -e "$H/etc/caddy/managed-sites/synergon.caddy" && ! -e "$H/state/caddy-running.synergon" ]]'
expect "the log file has the run (the output was gone)" 'grep -q "setup-server.sh --apply" "$H/state/setup.log" && grep -q "previous state was put back" "$H/state/setup.log"'

echo "16. the SSH session drops (SIGHUP) right after the reload: the change is undone and Caddy reloaded (security review M1)"
H=$(new_host)
HUP_AFTER_RELOAD=1 run hup "$H" --apply
expect "stopped, new site file removed" '[[ $(rc hup) != 0 && ! -e "$H/etc/caddy/managed-sites/synergon.caddy" ]]'
expect "and Caddy runs without it again" '[[ ! -e "$H/state/caddy-running.synergon" ]]'

echo "16b. the same while the apex file is being retired: the old apex file is back"
H=$(new_host)
run apply-hup "$H" --apply
mkdir -p "$H/srv/synergon/releases/20261125T120000Z-abc1234/server"; touch "$H/srv/synergon/releases/20261125T120000Z-abc1234/server/server.js"
ln -s "$H/srv/synergon/releases/20261125T120000Z-abc1234" "$H/srv/synergon/current"; echo "enabled active" >"$H/state/unit-synergon-server"
HUP_AFTER_RELOAD=1 run hup-apex "$H" --retire-apex
expect "stopped, old apex file back and running" '[[ $(rc hup-apex) != 0 ]] && cmp -s "$H/etc/caddy/managed-sites/mightwork-apex.caddy" "$APEX_BEFORE" && cmp -s "$H/state/caddy-running.apex" "$APEX_BEFORE"'

echo "17. the script's output is closed right after the reload: the change is still undone"
H=$(new_host)
CLOSE_OUTPUT_AFTER_RELOAD=1 run closed "$H" --apply
expect "new site file removed" '[[ ! -e "$H/etc/caddy/managed-sites/synergon.caddy" ]]'
expect "and Caddy runs without it again" '[[ ! -e "$H/state/caddy-running.synergon" ]]'
expect "the restore is in the system log" 'grep -q "restored" "$H/state/syslog"'

echo "18. the reader of the output (| tee, a dropped session) goes away early: the change is still undone"
H=$(new_host)
BREAK_OTHER_SITE=apply run_piped piped "$H" --apply
expect "new site file removed" '[[ ! -e "$H/etc/caddy/managed-sites/synergon.caddy" ]]'
expect "and Caddy runs without it again" '[[ ! -e "$H/state/caddy-running.synergon" ]]'

echo "19. the installed runtime is checked by its recorded SHA-256, a changed file keeps its owner and mode (S6)"
H=$(new_host)
run apply-hash "$H" --apply
expect "bun.sha256 records the zip and the binary" 'grep -q "^zip bun-linux-x64.zip " "$H/opt/synergon/runtime/bun.sha256" && grep -q "^bun " "$H/opt/synergon/runtime/bun.sha256"'
run check-hash "$H" --check
expect "--check: the binary is the recorded one" 'has check-hash "the binary is the one installed from bun-linux-x64.zip"'
printf '#!/bin/sh\necho 1.4.0\n# changed\n' >"$H/opt/synergon/runtime/bun"
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
expect "the unit names no path of another program (only synergon's own, and the host's Caddy, web root and backups)" '! grep -E "^(InaccessiblePaths|BindPaths|BindReadOnlyPaths|ReadWritePaths|TemporaryFileSystem)=" "$REPO/deploy/synergon-server.service" | tr " " "\n" | sed "s/^[A-Za-z]*=//" | grep -vE "^-?/(srv|opt|var/lib)(/synergon)?(:ro)?$|^-/etc/caddy$|^-/var/www$|^-/var/backups$" | grep -q .'

echo "21. the files agree with each other"
expect "the unit, the site file and the config name the same port" '[[ "$(grep -o "port [0-9]*" "$REPO/deploy/synergon-server.service" | head -1)" == "port 4191" ]] && grep -q "reverse_proxy 127.0.0.1:4191" "$REPO/deploy/synergon.caddy" && grep -q "^PORT=4191" "$REPO/deploy/setup-server.sh"'
expect "the site file serves /srv/synergon/current and hides its server/ folder" 'grep -q "root \* /srv/synergon/current" "$REPO/deploy/synergon.caddy" && grep -q "hide /srv/synergon/current/server" "$REPO/deploy/synergon.caddy" && grep -q "handle /server/\*" "$REPO/deploy/synergon.caddy"'
expect "the gate is confined to /srv/synergon" 'grep -q "^R=/srv/synergon$" "$REPO/deploy/synergon-deploy-gate.sh"'
expect "the apex file has no route and no proxy: only a 404" '! grep -qE "^[[:space:]]*(handle|handle_path|reverse_proxy|file_server|redir|root)" "$REPO/deploy/mightwork-apex.caddy" && grep -q "respond \"Not found\" 404" "$REPO/deploy/mightwork-apex.caddy"'

echo
echo "setup-server.sh test: $PASS passed, $FAIL failed (logs in $OUT)"
[[ $FAIL == 0 ]]
