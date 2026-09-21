#!/usr/bin/env bash
# Gate de repo público. Uso: .github/scripts/repo-guard.sh history|tree
#   history = todos los commits de todas las refs (previo al primer push)
#   tree    = archivos trackeados en HEAD (CI de cada PR)
set -euo pipefail
mode="${1:-tree}"; fail=0

BAD_NAMES='\.(xlsx?|xlsm|ods|pem|key|p12|pfx|sqlite3?|dump|bak)$|\.sql\.gz$|(^|/)\.env|(^|/)tmp/|(^|/)\.vercel/|(^|/)\.claude/|(^|/)node_modules/|(^|/)\.next/'
PRIVATE_IDS='(team|prj)_[A-Za-z0-9]{20,}|pub-[0-9a-f]{32}\.r2\.dev|[a-z0-9-]+-pooler\.[a-z0-9.-]+\.neon\.tech'

if [ "$mode" = "history" ]; then
  names=$(git log --all --name-only --format= | sort -u)
else
  names=$(git ls-files)
fi
hits=$(printf '%s\n' "$names" | grep -iE "$BAD_NAMES" || true)
if [ -n "$hits" ]; then echo "::error::Archivos prohibidos:"; printf '%s\n' "$hits"; fail=1; fi

if [ "$mode" = "history" ]; then
  big=$(git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' \
        | awk '$1=="blob" && $2>5242880 {print $2, $3}')
  if [ -n "$big" ]; then echo "::error::Blobs de más de 5 MB:"; printf '%s\n' "$big"; fail=1; fi
  # -G ya interpreta una regex; --pickaxe-regex es solo para -S y git rechaza la combinación.
  # Sin "|| true": si git falla, el guard tiene que fallar, no dar OK en silencio.
  ids=$(git log --all --format=%h -E -G"$PRIVATE_IDS")
  if [ -n "$ids" ]; then echo "::error::Commits con identificadores privados:"; printf '%s\n' "$ids"; fail=1; fi
else
  ids=$(git grep -IlE "$PRIVATE_IDS" -- . ':!.github/scripts/repo-guard.sh' || true)
  if [ -n "$ids" ]; then echo "::error::Archivos con identificadores privados:"; printf '%s\n' "$ids"; fail=1; fi
  urls=$(grep -nE 'https?://' .github/workflows/*.yml | grep -v 'npm\.pkg\.github\.com' || true)
  if [ -n "$urls" ]; then echo "::error::URLs hardcodeadas en workflows (van como secret):"; printf '%s\n' "$urls"; fail=1; fi
fi

[ "$fail" -eq 0 ] && echo "repo-guard ($mode): OK"
exit "$fail"
