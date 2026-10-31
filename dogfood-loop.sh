#!/usr/bin/env bash
# Run continuous dogfood in **this terminal** (visible output). Ctrl+C to stop.
exec "$(cd "$(dirname "$0")" && pwd)/scripts/run-dogfood-foreground.sh"
