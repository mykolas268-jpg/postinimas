#!/usr/bin/env bash
# Commit everything in a checkout of the `state` branch and push it.
#   usage: scripts/push-state.sh <state-dir> <commit message>
#
# costs.jsonl and runs.jsonl are append-only. Two runs appending at the same
# time would otherwise conflict at the end of the file and the second push
# would fail — losing that run's spend from the ledger the monthly cap reads.
# The union merge driver keeps both sides' lines; the push is retried after
# merging the remote state.
set -euo pipefail

dir=$1
message=$2
cd "$dir"

grep -qxF '*.jsonl merge=union' .gitattributes 2>/dev/null || echo '*.jsonl merge=union' >> .gitattributes
git add -A
if git diff --cached --quiet; then
  echo "No state changes"
  exit 0
fi

identity=(-c user.name="verslas-pipeline" -c user.email="actions@users.noreply.github.com")
git "${identity[@]}" commit -q -m "$message"

for attempt in 1 2 3 4 5; do
  if git push -q origin HEAD:state; then
    exit 0
  fi
  echo "State push rejected (attempt ${attempt}); merging the remote state and retrying."
  sleep $((attempt * 2))
  git "${identity[@]}" pull -q --no-rebase --no-edit origin state
done
echo "::error::Could not push the state branch after 5 attempts."
exit 1
