#!/usr/bin/env bash
# Appends one image request to images-todo.md (protocol: README.md).
# Usage: request.sh <ID> <file-name.png> <<'BODY'
#          - Requested: by …
#          - Size: …
#          - Prompt: …
#        BODY
# Prints the absolute Save to path. Safe to call from parallel agents.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
QUEUE="$DIR/images-todo.md"
id="${1:?usage: request.sh <ID> <file-name.png> < body}"
name="${2:?usage: request.sh <ID> <file-name.png> < body}"
[[ "$id" =~ ^IMG-[A-Za-z0-9-]+$ ]] || { echo "ID must match IMG-[A-Za-z0-9-]+" >&2; exit 1; }
[[ "$name" =~ ^[A-Za-z0-9._-]+\.png$ ]] || { echo "file name must be a plain .png name" >&2; exit 1; }
# Installed together, both helpers use the crash-recoverable lock. Keep
# standalone copies interoperable with older installations of the protocol.
if [[ -f "$DIR/worker.py" ]] && grep -q 'commands.add_parser("append")' "$DIR/worker.py"; then
  exec python3 "$DIR/worker.py" --root "$DIR" append "$id" "$name"
fi
body="$(cat)"
[[ "$body" == *"Prompt:"* ]] || { echo "body must contain a '- Prompt:' field" >&2; exit 1; }
save="$DIR/out/$id/$name"
mkdir -p "$DIR/out/$id"
# mkdir is atomic: a portable lock so parallel appends never interleave.
lock="$DIR/.queue.lock"
acquired=false
for _ in $(seq 1 100); do
  if mkdir "$lock" 2>/dev/null; then acquired=true; break; fi
  sleep 0.1
done
[[ "$acquired" == true ]] || { echo "could not lock the queue" >&2; exit 1; }
trap 'rmdir "$lock"' EXIT
if grep -qx "## $id" "$QUEUE"; then echo "request $id already exists" >&2; exit 1; fi
{
  printf '\n## %s\n- Status: pending\n- Filed: %s\n- Save to: %s\n' \
    "$id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$save"
  printf '%s\n' "$body"
} >> "$QUEUE"
echo "$save"
