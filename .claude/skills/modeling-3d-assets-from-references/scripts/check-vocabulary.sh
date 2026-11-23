#!/usr/bin/env bash
# check-vocabulary.sh: keeps this Skill general and free of names.
#
#   1. Asset-type vocabulary must not appear in the core files: SKILL.md, CHANGELOG.md,
#      references/*.md and the agent definitions in .claude/agents/. Such words belong in
#      playbooks/. Exemptions: the object-type list in SKILL.md's frontmatter may use the one
#      generic word listed in FRONTMATTER_OK; lines between
#      "<!-- vocab:example -->" and "<!-- /vocab:example -->" are skipped.
#   2. Banned names (brands, clients, customers, people) must not appear in ANY file of the Skill
#      or in the agent definitions. The names are never written here: they are read from
#      private/banned-words.txt (one per line, # for comments), from the encoded lists in
#      tools/check.ts, and from --banned-b64. Hits are reported by list position, not by word.
#
# Usage:  bash .claude/skills/modeling-3d-assets-from-references/scripts/check-vocabulary.sh \
#              [--banned-b64 <base64>[,<base64>...]]
# Exit:   0 clean; 1 hits; 2 the banned-name list is empty, so part 2 could not run.
set -u

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
AGENTS_DIR="$ROOT/.claude/agents"

# Words that mark text as being about one asset type. Extend when a new playbook is added.
WORDS='seat|joystick|pedal|monitor|pod|armrest|backrest|headrest|touchscreen|soundbar|cushion|deck|rig'
FRONTMATTER_OK='rig'   # allowed only in SKILL.md's frontmatter (the list of object types that trigger the Skill)

EXTRA_B64=""
while [ $# -gt 0 ]; do
  case "$1" in
    --banned-b64) EXTRA_B64="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

decode() { printf '%s' "$1" | base64 --decode 2>/dev/null || printf '%s' "$1" | base64 -D 2>/dev/null; }

# ---------------------------------------------------------------------------------- 1. vocabulary
core=("$SKILL_DIR/SKILL.md" "$SKILL_DIR/CHANGELOG.md")
for f in "$SKILL_DIR"/references/*.md "$AGENTS_DIR"/asset-*.md "$AGENTS_DIR"/component-modeller.md; do
  [ -f "$f" ] && core+=("$f")
done

vocab_hits=0
for f in "${core[@]}"; do
  [ -f "$f" ] || { echo "MISSING core file: ${f#$ROOT/}"; vocab_hits=$((vocab_hits + 1)); continue; }
  fm=0; case "$f" in */SKILL.md) fm=1 ;; esac
  out="$(awk -v words="$WORDS" -v ok="$FRONTMATTER_OK" -v fm="$fm" -v name="${f#$ROOT/}" '
    BEGIN { all = "(^|[^a-z])(" words ")s?($|[^a-z])"
            n = split(words, w, "|"); rest = ""
            for (i = 1; i <= n; i++) if (w[i] != ok) rest = rest (rest == "" ? "" : "|") w[i]
            lax = "(^|[^a-z])(" rest ")s?($|[^a-z])"; dashes = 0; skip = 0 }
    { line = tolower($0) }
    $0 ~ /^---[[:space:]]*$/ { dashes++ }
    line ~ /<!-- *vocab:example *-->/  { skip = 1 }
    line ~ /<!-- *\/vocab:example *-->/ { skip = 0; next }
    skip { next }
    { re = (fm == 1 && dashes < 2) ? lax : all
      if (line ~ re || line ~ /img_[0-9]/) printf "%s:%d: %s\n", name, NR, $0 }
  ' "$f")"
  if [ -n "$out" ]; then echo "$out"; vocab_hits=$((vocab_hits + $(printf '%s\n' "$out" | wc -l))); fi
done
echo "vocabulary: ${#core[@]} core files scanned, $vocab_hits hit(s)"

# ---------------------------------------------------------------------------------- 2. banned names
names_file="$(mktemp)"; trap 'rm -f "$names_file"' EXIT
if [ -f "$ROOT/private/banned-words.txt" ]; then
  grep -v '^[[:space:]]*#' "$ROOT/private/banned-words.txt" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' >> "$names_file"
fi
if [ -f "$ROOT/tools/check.ts" ]; then
  for b in $(grep '\.map(dec)' "$ROOT/tools/check.ts" | grep -o '"[A-Za-z0-9+/=]\{4,\}"' | tr -d '"'); do
    decode "$b" >> "$names_file"; echo >> "$names_file"
  done
fi
for b in $(printf '%s' "$EXTRA_B64" | tr ',' ' '); do decode "$b" >> "$names_file"; echo >> "$names_file"; done
tr '[:upper:]' '[:lower:]' < "$names_file" | grep -v '^$' | sort -u > "$names_file.u"; mv "$names_file.u" "$names_file"
count=$(wc -l < "$names_file" | tr -d ' ')
if [ "$count" -eq 0 ]; then
  echo "banned names: NONE LOADED (no private/banned-words.txt, no encoded list in tools/check.ts, no --banned-b64); part 2 did not run"
  [ "$vocab_hits" -gt 0 ] && exit 1
  exit 2
fi

harmless="$(decode 'YXJjaGl2ZQ==')"   # an ordinary word that contains one of the names; removed before matching
name_hits=0; scanned=0
while IFS= read -r f; do
  scanned=$((scanned + 1))
  out="$(awk -v harmless="$harmless" -v name="${f#$ROOT/}" '
    NR == FNR { n++; ban[n] = $0; next }
    { line = tolower($0); while ((i = index(line, harmless)) > 0) line = substr(line, 1, i - 1) substr(line, i + length(harmless))
      for (k = 1; k <= n; k++) {
        if (length(ban[k]) <= 3) { if (line ~ ("(^|[^a-z])" ban[k] "($|[^a-z])")) printf "%s:%d: banned name #%d\n", name, FNR, k }
        else if (index(line, ban[k]) > 0) printf "%s:%d: banned name #%d\n", name, FNR, k
      } }
  ' "$names_file" "$f")"
  if [ -n "$out" ]; then echo "$out"; name_hits=$((name_hits + $(printf '%s\n' "$out" | wc -l))); fi
  base="$(basename "$f" | tr '[:upper:]' '[:lower:]' | sed "s/$harmless//g")"
  while IFS= read -r nm; do
    [ "${#nm}" -gt 3 ] || continue
    case "$base" in *"$nm"*) echo "${f#$ROOT/}: banned name in the file name"; name_hits=$((name_hits + 1)) ;; esac
  done < "$names_file"
done < <(find "$SKILL_DIR" "$AGENTS_DIR" -type f \( -name '*.md' -o -name '*.sh' -o -name '*.toml' -o -name '*.json' -o -name '*.txt' -o -name '*.ts' -o -name '*.py' \) 2>/dev/null | sort)
echo "banned names: $count name(s) loaded, $scanned files scanned, $name_hits hit(s)"

[ $((vocab_hits + name_hits)) -eq 0 ] && { echo "check-vocabulary: clean"; exit 0; }
echo "check-vocabulary: FAILED"; exit 1
