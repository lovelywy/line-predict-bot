#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose down
printf 'หยุด LINE Predict Bot แล้ว\n'
read -r -p 'กด Enter เพื่อปิด...'
