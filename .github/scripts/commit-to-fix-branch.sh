#!/usr/bin/env bash
# Commit the given paths to the fix branch, rebasing on parallel jobs' pushes.
set -u
PATHS="$1"; MSG="$2"; BR=fix/bible-text-integrity
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
for p in $PATHS; do [ -e "$p" ] && git add "$p"; done
if git diff --cached --quiet; then echo "nothing to commit"; exit 0; fi
git commit -q -m "$MSG (+$(git diff --cached --name-only HEAD~0 2>/dev/null | wc -l | tr -d ' ') files)" || git commit -q -m "$MSG"
for attempt in 1 2 3 4 5 6 7 8; do
  if git pull -q --rebase origin "$BR" && git push -q origin "HEAD:$BR"; then echo "pushed"; exit 0; fi
  echo "push rejected (attempt $attempt), retrying"; sleep $((attempt * 4))
done
echo "::error::could not push $MSG"; exit 1
