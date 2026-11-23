#!/bin/bash
# rigtwin deploy gate: the forced command for every SSH key of the `rigtwin-deploy` account on the
# production host (installed as /usr/local/bin/rigtwin-deploy-gate; see
# wiki/50-implementation/deployment.md). sshd runs this script instead of whatever the client asked
# for; the request is in SSH_ORIGINAL_COMMAND. Only the exact command shapes that tools/deploy.ts
# sends are allowed, each confined to /srv/rigtwin. Anything else is refused and logged.
#
# The patterns are anchored at both ends and built only from fixed text and narrow character
# classes, so an allowed request cannot carry extra shell syntax.

set -u
cmd="${SSH_ORIGINAL_COMMAND:-}"
R=/srv/rigtwin
REL='[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9_+-][A-Za-z0-9._+-]*'
P="$R/releases/$REL"
# rsync's server side, as started by GNU rsync (CI runner) or openrsync (macOS): options are single
# dash flag groups or --long options with simple values, then "." and the release folder.
RSYNC_OPTS='( -[A-Za-z.]+| --[a-z-]+(=[A-Za-z0-9,._-]+)?)*'

allowed=(
  "^mkdir -p $R/releases\$"
  "^readlink $R/current \|\| true\$"
  "^ls -1 $R/releases\$"
  "^test -e $P && echo exists \|\| true\$"
  "^chmod -R u\+rwX,go\+rX,go-w $P && test -f $P/version\.json && test -f $P/index\.html\$"
  "^ln -sfn $P $R/current\.tmp && mv -T $R/current\.tmp $R/current\$"
  "^cat $P/version\.json\$"
  "^rm -rf --( $P)+\$"
  "^rsync --server$RSYNC_OPTS \. $P/?\$"
)

refuse() { logger -t rigtwin-deploy-gate "REFUSED ($1): $cmd"; echo "rigtwin-deploy-gate: $1" >&2; exit 126; }

for re in "${allowed[@]}"; do
  [[ "$cmd" =~ $re ]] || continue
  logger -t rigtwin-deploy-gate "allowed: $cmd"
  # A release must never contain symbolic links: the web server would follow one to any readable file
  # on the host. Uploads are cleaned of links right after rsync finishes, and a release that still
  # contains one cannot be switched live.
  if [[ "$cmd" =~ ^rsync ]]; then
    dest="${cmd##* }"; dest="${dest%/}"
    /bin/sh -c "$cmd"; rc=$?
    [[ -d "$dest" ]] && find "$dest" -type l -delete
    exit $rc
  fi
  if [[ "$cmd" =~ ^ln\ -sfn\ ($P)\  ]]; then
    target="${BASH_REMATCH[1]}"
    [[ -d "$target" ]] || refuse "no such release"
    [[ -z "$(find "$target" -type l -print -quit)" ]] || refuse "release contains a symbolic link"
  fi
  exec /bin/sh -c "$cmd"
done

logger -t rigtwin-deploy-gate "REFUSED: $cmd"
echo "rigtwin-deploy-gate: command not allowed for this key: $cmd" >&2
exit 126
