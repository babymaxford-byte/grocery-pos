#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
mkdir -p data/.manager/logs
node manager.js start --ui --no-browser
