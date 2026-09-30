#!/usr/bin/env bash
# On-demand AI penetration test with Strix — https://github.com/usestrix/strix
# NOT run in CI: Strix needs a paid LLM key and spends credits per run.
# See security/README.md for setup. Usage: ./security/strix-scan.sh [target-dir]
set -euo pipefail

command -v docker >/dev/null 2>&1 || { echo "Strix needs Docker installed and running. See security/README.md"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Start Docker Desktop."; exit 1; }
command -v strix >/dev/null 2>&1 || { echo "Strix not installed. Run: pipx install strix-agent"; exit 1; }
: "${LLM_API_KEY:?Set LLM_API_KEY (your LLM provider key). See security/README.md}"
: "${STRIX_LLM:?Set STRIX_LLM (provider/model, e.g. from docs.strix.ai). See security/README.md}"

TARGET="${1:-.}"
echo "Running Strix against: $TARGET  (model: $STRIX_LLM)"
strix --target "$TARGET"
