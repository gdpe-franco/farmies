#!/bin/sh
set -eu

docker compose --profile art run --rm aseprite \
  --layer body --list-tags --list-slices cow.aseprite \
  --sheet cow-atlas.png --data cow-atlas.json --format json-array \
  --sheet-type rows --sheet-columns 4

docker compose --profile art run --rm aseprite \
  --layer head-mask cow.aseprite \
  --sheet cow-head-masks.png --data /tmp/cow-head-masks.json \
  --sheet-type rows --sheet-columns 4
