#!/usr/bin/env bash
# Shim for local scripts; slim Docker images copy _lib/ only.
# shellcheck source=../../_lib/dogfood-sdk-source.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/_lib/dogfood-sdk-source.sh"
