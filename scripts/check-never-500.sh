#!/bin/bash
# Guardrail: Ensure critical API routes follow the "Never 500" pattern
#
# This is a thin wrapper around the manifest-driven Node.js validator.
# The canonical list of critical routes is in: scripts/critical-routes.manifest.json
#
# Usage:
#   ./scripts/check-never-500.sh          # Static file checks only
#   ./scripts/check-never-500.sh --live   # Also run live HTTP checks (requires BASE env)
#
# Critical routes must:
# 1. Always return HTTP 200 (errors in response body)
# 2. Include x-correlation-id header for tracing
# 3. Include x-buddy-route header for route identity
# 4. Use jsonSafe or respond200 for serialization
#
# To add a new critical route, edit: scripts/critical-routes.manifest.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node "${SCRIPT_DIR}/check-never-500.mjs" "$@"
