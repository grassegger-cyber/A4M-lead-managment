#!/bin/bash
# Installs dependencies without letting iCloud touch them.
# npm replaces a symlinked node_modules with a real folder, which iCloud then starts to sync
# and evict. So the install runs in a temporary folder outside iCloud and the result is moved
# to node_modules.nosync (same disk, instant), with node_modules as a symlink to it.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="$(pwd)"
STAGE="$(mktemp -d /tmp/a4m-lm-deps.XXXXXX)"
cp package.json "$STAGE/"
[ -f package-lock.json ] && cp package-lock.json "$STAGE/"
if [ -f package-lock.json ] && [ "$#" -eq 0 ]; then
	(cd "$STAGE" && npm ci --no-audit --no-fund)
else
	# Extra arguments are passed to npm install (e.g. a new package name).
	(cd "$STAGE" && npm install --no-audit --no-fund "$@")
	cp "$STAGE/package.json" "$STAGE/package-lock.json" "$PROJECT/"
fi
[ -L node_modules ] && rm node_modules
if [ -d node_modules.nosync ]; then
	mv node_modules.nosync "$STAGE/old-node_modules"
fi
mv "$STAGE/node_modules" node_modules.nosync
ln -s node_modules.nosync node_modules
rm -rf "$STAGE"
echo "Dependencies installed into node_modules.nosync"
# Without fsevents the dev server watches files by polling, which keeps a CPU core busy.
if [ "$(uname)" = "Darwin" ] && [ ! -d node_modules.nosync/fsevents ]; then
	echo "WARNING: node_modules.nosync/fsevents is missing (optional dependency not installed)." >&2
	echo "         npm run dev will poll the file system. Run this script again, or use npm start." >&2
fi
