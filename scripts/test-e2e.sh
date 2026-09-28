#!/bin/sh
# Build, start the API, run both apps' Playwright suites, and always stop the API.
set -eu

HTTP_PORT="${HTTP_PORT:-3001}"

pnpm exec turbo run build

# Stop the whole pnpm -> sh -> tsx -> node tree: killing only $! used to orphan the
# API on :3001. Process groups (set -m) need a TTY, which CI does not have.
kill_tree() {
	for child in $(pgrep -P "$1"); do
		kill_tree "$child"
	done
	kill -TERM "$1" 2>/dev/null || true
}

pnpm --filter @chirp/api start &
API_PID=$!
trap 'kill_tree "$API_PID"' EXIT INT TERM

tries=0
until curl -sf "http://localhost:$HTTP_PORT/health" >/dev/null 2>&1; do
	if ! kill -0 "$API_PID" 2>/dev/null; then
		echo "API exited during startup" >&2
		exit 1
	fi
	tries=$((tries + 1))
	if [ "$tries" -gt 120 ]; then
		echo "API not healthy on :$HTTP_PORT after 60s" >&2
		exit 1
	fi
	sleep 0.5
done

# --continue: a failure in one app must not cancel the other app's suite.
pnpm exec turbo run test:e2e --continue
