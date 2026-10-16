#!/usr/bin/env bash
# Pins SealedBox.swift against libsodium: vectors.json holds sealed boxes,
# a secretbox, a BLAKE2b-192 and a Poly1305 tag made by libsodium
# (gen-vectors.mjs, needs `npm i libsodium-wrappers-sumo` next to it), and
# main.swift opens them with the extension's code. Needs Xcode's swiftc.
#
#   plugins/notification-service/check/run.sh
set -euo pipefail
cd "$(dirname "$0")"
out="$(mktemp -d)"
swiftc -O ../SealedBox.swift main.swift -o "$out/check"
"$out/check" vectors.json
