#!/usr/bin/env bash
# Back-compat alias — installs YACE + static Azure/GCP exporters (see install-floci-cloud-k8s.sh).
exec "$(cd "$(dirname "$0")" && pwd)/install-floci-cloud-k8s.sh" "$@"
