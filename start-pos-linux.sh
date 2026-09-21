#!/bin/bash
set -e
cd "$(dirname "$0")"
mkdir -p data/.manager/logs
nohup node manager.js start > data/.manager/logs/launcher.log 2>&1 &
echo "Grocery POS Manager started in the background."
