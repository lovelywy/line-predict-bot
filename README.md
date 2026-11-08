# LINE Predict Bot

เกมทายผลในกลุ่ม LINE แบบ **เล่นฟรี ใช้แต้มเท่านั้น** ไม่มีเงินจริงในระบบ

- ผู้เล่นทุกคนได้แต้มเริ่มต้นเท่ากันเมื่อสมัคร (`STARTING_POINTS`, ค่าเริ่มต้น 1,000) และรับแต้มฟรีรายวันได้ (`DAILY_BONUS_POINTS`, ค่าเริ่มต้น 100, ตั้ง 0 เพื่อปิด)
- แต้มไม่มีมูลค่าเป็นเงิน ซื้อ ขาย โอน หรือแลกไม่ได้ ไม่มีคำสั่งฝาก/ถอน และ Admin เพิ่มแต้มให้ใครไม่ได้
- Admin เปิดรอบพร้อมคำถามและตัวเลือก (2–6 ข้อ แต่ละข้อมีตัวคูณ), ปิดรอบ, แล้วเฉลย
- ผู้เล่นทาย `ทาย <ข้อ> <แต้ม>` รอบละครั้ง ทายถูกได้ `แต้มที่ลง × ตัวคูณ`
- มีตารางคะแนน `/อันดับ`
- ตรวจ LINE HMAC signature, กัน Webhook event และ Message ซ้ำ, ทุกการเปลี่ยนแต้มอยู่ใน Transaction และบันทึกใน `point_ledger`

คำสั่งทั้งหมด: [docs/COMMANDS.md](docs/COMMANDS.md) • Checklist: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)

## Environment

```dotenv
PORT=3000
DATABASE_URL=postgres://predictbot:predictbot@localhost:5432/predictbot
LINE_CHANNEL_SECRET=...           # LINE Developers > Basic settings
LINE_CHANNEL_ACCESS_TOKEN=...     # LINE Developers > Messaging API (long-lived)
BOOTSTRAP_ADMIN_KEY=...           # openssl rand -hex 24
STARTING_POINTS=1000
DAILY_BONUS_POINTS=100
GAME_TIMEZONE=Asia/Bangkok
LINE_DRY_RUN=false                # true = log replies instead of calling LINE (local testing)
```

ห้ามส่ง `.env` เข้า Git

## รันบนเครื่อง

```bash
cp .env.example .env              # แก้ค่าตามด้านบน
docker compose up -d --build      # Postgres + app; schema ใน sql/001_init.sql ถูกสร้างอัตโนมัติ
curl http://localhost:3000/health # {"ok":true,"service":"line-predict-bot"}
```

ไม่ใช้ Docker: `npm install`, `npm run db:init`, `npm start` (Node.js 22+)

บน Mac ดับเบิลคลิก `START-MAC.command` / `STOP-MAC.command` ได้

## เชื่อมกับ LINE

1. สร้าง Messaging API channel ใน LINE Developers แล้วนำ Channel secret และ Channel access token ใส่ `.env`
2. เปิด HTTPS URL สาธารณะ (VPS + Caddy ด้านล่าง หรือ tunnel ระหว่างทดสอบ) แล้วตั้ง Webhook URL เป็น `https://YOUR_DOMAIN/webhook`, เปิด Use webhook, กด Verify
3. เปิดให้ Bot เข้ากลุ่มได้ (Allow bot to join group chats) และปิด Auto-reply messages
4. แชตส่วนตัวกับ Bot: `/ตั้งแอดมิน BOOTSTRAP_KEY ชื่อ` จากนั้นเปลี่ยน key ใหม่และ restart
5. เพิ่ม Bot เข้ากลุ่ม Admin พิมพ์ `/เริ่มกลุ่ม`

## ตัวอย่างหนึ่งรอบ

```text
สมัคร สมชาย                                    (ผู้เล่น → ได้ 1,000 แต้ม)
/เปิดรอบ ใครชนะ? | แดง x1.5 | น้ำเงิน x2        (Admin)
ทาย 1 200                                      (ผู้เล่น)
/ปิดรอบ                                         (Admin)
/เฉลย 1                                         (Admin → สมชาย +100 สุทธิ)
/อันดับ
```

## Test

```bash
npm test                                                   # unit tests
TEST_DATABASE_URL=postgres://.../predictbot_test npm test  # + integration (TRUNCATEs tables — never point at production)
```

## Deploy บน VPS

```bash
cp .env.production.example .env   # ใส่ DOMAIN, รหัส Postgres, LINE secret/token, bootstrap key
docker compose -f compose.production.yml up -d --build
```

Caddy ทำ HTTPS อัตโนมัติเมื่อ DNS ของ `DOMAIN` ชี้มาที่ VPS (เปิดพอร์ต 80/443). Backup: `set -a; . ./.env; set +a; ./scripts/backup.sh`
