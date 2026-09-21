#!/usr/bin/env bash
set -euo pipefail

# EverJoy / Grocery POS Linux Mint setup script
# Installs the system prerequisites and project npm dependencies.
# Run from the POS project directory: ./install-linux.sh

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

log() { printf '\n\033[1;32m[POS SETUP]\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m[POS SETUP WARNING]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[POS SETUP ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

if [[ "${EUID}" -eq 0 ]]; then
  fail "Do not run this script with sudo. Run it as your normal Linux user. The script will ask for sudo only when system packages are needed."
fi

command -v sudo >/dev/null 2>&1 || fail "sudo is required."
command -v apt-get >/dev/null 2>&1 || fail "This installer is intended for Debian/Ubuntu/Linux Mint systems using apt."

# Fix ownership if the project was copied/extracted as another user/root.
if [[ ! -w "$APP_DIR" ]]; then
  log "Project directory is not writable by the current user. Fixing ownership..."
  sudo chown -R "$USER":"$(id -gn)" "$APP_DIR"
fi

# Basic native build tools are useful/required when better-sqlite3 needs to compile.
log "Installing Linux build prerequisites..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl build-essential python3 make g++

node_ok=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major >= 20 )); then
    node_ok=1
    log "Node.js $(node -v) is already installed."
  else
    warn "Node.js $(node -v 2>/dev/null || echo unknown) is too old. EverJoy POS requires Node.js 20 or newer."
  fi
fi

if (( node_ok == 0 )); then
  log "Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

command -v node >/dev/null 2>&1 || fail "Node.js installation failed."
command -v npm >/dev/null 2>&1 || fail "npm installation failed."

node_major="$(node -p 'process.versions.node.split(".")[0]')"
(( node_major >= 20 )) || fail "Node.js $(node -v) is too old. Please install Node.js 20+ and run this script again."

log "Node.js: $(node -v)"
log "npm: $(npm -v)"

# Ensure shell launchers are executable.
chmod +x ./*.sh 2>/dev/null || true

# If node_modules came from Windows or another machine, native modules can be incompatible.
if [[ -d node_modules ]]; then
  log "Removing existing node_modules so Linux gets clean Linux dependencies..."
  rm -rf node_modules
fi

# Keep package-lock if present so npm can use the locked dependency tree. If it was copied
# from another platform it is still portable; node_modules is the platform-specific part.
log "Installing POS npm dependencies..."
npm install

# Repair executable bits for npm binaries in case the project was copied from a filesystem
# that dropped them.
if [[ -d node_modules/.bin ]]; then
  chmod +x node_modules/.bin/* 2>/dev/null || true
fi

# Detect a noexec mount, which prevents scripts/binaries from executing even with +x.
if command -v findmnt >/dev/null 2>&1; then
  mount_info="$(findmnt -no TARGET,FSTYPE,OPTIONS "$APP_DIR" 2>/dev/null || true)"
  if grep -qE '(^|,)noexec(,|$)' <<<"$mount_info"; then
    warn "This project is on a noexec filesystem: $mount_info"
    warn "Move the POS folder to your Linux home directory (for example ~/GroceryPOS) and run this installer there."
  fi
fi

log "Checking POS files..."
[[ -f package.json ]] || fail "package.json is missing."
[[ -f server/index.js ]] || fail "server/index.js is missing."
[[ -f manager.js ]] || fail "manager.js is missing."

node --check manager.js
node --check server/index.js

log "Setup complete!"
echo
echo "You can now launch the POS with:"
echo "  ./start-pos-linux.sh"
echo
echo "Or launch the Manager with:"
echo "  ./start-manager-linux.sh"
echo
echo "If you want to test without the Manager:"
echo "  npm run dev"
echo
echo "POS:     http://127.0.0.1:5173"
echo "Manager: http://127.0.0.1:3010"
echo
