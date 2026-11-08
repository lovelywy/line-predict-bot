#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

printf '\nLINE Predict Bot\n================\n\n'

if ! command -v docker >/dev/null 2>&1; then
  printf 'ไม่พบ Docker กรุณาเปิดหรือติดตั้ง Docker Desktop ก่อน\n'
  read -r -p 'กด Enter เพื่อปิด...'
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  printf 'Docker Desktop ยังไม่ทำงาน กรุณาเปิด Docker Desktop แล้วรันไฟล์นี้ใหม่\n'
  read -r -p 'กด Enter เพื่อปิด...'
  exit 1
fi

if [ ! -f .env ]; then
  printf 'ตั้งค่าครั้งแรก ข้อมูลจะถูกเก็บใน .env บนเครื่องนี้เท่านั้น\n\n'
  read -r -p 'LINE Channel Secret: ' LINE_SECRET
  read -r -s -p 'LINE Channel Access Token: ' LINE_TOKEN
  printf '\n'

  if [ -z "$LINE_SECRET" ] || [ -z "$LINE_TOKEN" ]; then
    printf 'Secret และ Token ห้ามว่าง\n'
    exit 1
  fi

  BOOTSTRAP_KEY="$(openssl rand -hex 24)"
  cat > .env <<ENV
PORT=3000
NODE_ENV=development
DATABASE_URL=postgres://predictbot:predictbot@localhost:5432/predictbot
LINE_CHANNEL_SECRET=${LINE_SECRET}
LINE_CHANNEL_ACCESS_TOKEN=${LINE_TOKEN}
BOOTSTRAP_ADMIN_KEY=${BOOTSTRAP_KEY}
STARTING_POINTS=1000
DAILY_BONUS_POINTS=100
MAX_BODY_BYTES=1048576
ENV
  chmod 600 .env

  printf '\nBootstrap Admin Key ของพี่คือ:\n\n%s\n\n' "$BOOTSTRAP_KEY"
  printf 'เก็บค่านี้ไว้ใช้คำสั่ง /ตั้งแอดมิน ในแชตส่วนตัวกับ Bot\n\n'
else
  printf 'พบ .env เดิม จะใช้ค่าที่ตั้งไว้แล้ว\n\n'
fi

docker compose up -d --build

printf '\nกำลังตรวจระบบ...\n'
for _ in {1..30}; do
  if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
    printf '\nระบบทำงานแล้ว: http://localhost:3000/health\n'
    if command -v open >/dev/null 2>&1; then
      open http://localhost:3000/health
    fi
    printf '\nขั้นถัดไป: สร้าง Public HTTPS URL แล้วตั้ง LINE Webhook เป็น URL ที่ลงท้ายด้วย /webhook\n'
    read -r -p 'กด Enter เพื่อปิดหน้าต่างนี้...'
    exit 0
  fi
  sleep 1
done

printf '\nระบบยังไม่ตอบ Health Check ดู Log ด้วยคำสั่ง:\n  docker compose logs -f app\n'
read -r -p 'กด Enter เพื่อปิด...'
exit 1
