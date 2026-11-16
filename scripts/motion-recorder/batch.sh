#!/bin/sh
# batch.sh <port> <jobs...> ; job = scene:mode
port=$1; shift
for j in "$@"; do REC_PORT=$port timeout 2400 node "$(dirname "$0")/render.mjs" ${j%%:*} ${j##*:} "$REC_ROOT/out" | cut -c1-300; done
