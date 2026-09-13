#!/usr/bin/env bash
# Run a real Tabby headlessly (Xvfb) with this plugin linked in and remote
# debugging on :9222, so the other scripts in this folder can drive it.
#
#   scripts/e2e/run-tabby.sh            # downloads Tabby on first use
#   TABBY_VERSION=1.0.235 scripts/e2e/run-tabby.sh
#
# Requires: xvfb-run, curl, tar, and the usual Electron runtime libs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
E2E_DIR="${E2E_DIR:-$ROOT/.e2e}"
TABBY_VERSION="${TABBY_VERSION:-1.0.235}"
ARCH="$(uname -m)"; case "$ARCH" in aarch64|arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; esac
TARBALL="tabby-${TABBY_VERSION}-linux-${ARCH}.tar.gz"
APP_DIR="$E2E_DIR/tabby/tabby-${TABBY_VERSION}-linux-${ARCH}"

mkdir -p "$E2E_DIR/tabby" "$E2E_DIR/home/.config/tabby" "$E2E_DIR/plugins/node_modules"
if [ ! -x "$APP_DIR/tabby" ]; then
    echo "Downloading Tabby ${TABBY_VERSION} (${ARCH})…"
    curl -fL -o "$E2E_DIR/$TARBALL" "https://github.com/Eugeny/tabby/releases/download/v${TABBY_VERSION}/${TARBALL}"
    tar -xzf "$E2E_DIR/$TARBALL" -C "$E2E_DIR/tabby"
fi
ln -sfn "$ROOT" "$E2E_DIR/plugins/node_modules/tabby-ai-panel"

CONFIG="$E2E_DIR/home/.config/tabby/config.yaml"
if [ ! -f "$CONFIG" ]; then
    cat > "$CONFIG" <<YAML
version: 8
enableWelcomeTab: false
aiPanel:
  endpoint: http://127.0.0.1:18080
  model: fake-model
  panelVisible: true
  approvalMode: ask
YAML
fi

export HOME="$E2E_DIR/home"
export XDG_CONFIG_HOME="$E2E_DIR/home/.config"
export TABBY_PLUGINS="$E2E_DIR/plugins/node_modules"
echo "Tabby log: $E2E_DIR/tabby.log   (CDP on http://localhost:9222)"
exec xvfb-run -a --server-args="-screen 0 1600x1000x24" "$APP_DIR/tabby" \
    --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --remote-debugging-port=9222 --enable-logging=stderr --v=0 > "$E2E_DIR/tabby.log" 2>&1
