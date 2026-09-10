# Changelog

บันทึกการทำงานทุกรุ่นของ uba-ai ตามกฎ pre-deploy ของโปรเจกต์: bump version ใน `package.json` และ `src/version.ts` พร้อมบันทึก additions/fixes/improvements ใน `patchUpdates` ก่อน publish ทุกครั้ง

แหล่งข้อมูลในโค้ด: `src/version.ts` (`version` + `patchUpdates`) - ดูจาก CLI ได้ด้วย `uba version`

## 0.2.0 - 2026-09-10

### Added (feat)

- **Pluggable storage layer ต่อ SQL ได้** - คง default เป็น JSONL file หรือสลับไป SQL ผ่าน `node:sqlite` ที่มากับ Node (>= 22.5) ได้ด้วยการตั้ง `"storage": { "backend": "sqlite" }` ใน `uba.config.json` - ยัง zero external dependencies เหมือนเดิม, SQLite backend ใช้ตาราง `events` พร้อม index บน timestamp/user_id/event และเขียนแบบ transaction
- **Sectioned JSON configuration** - config แยกเป็นส่วนๆ (`storage`, `ai`, analysis settings) override แยกแต่ละส่วนได้โดย field ที่ไม่ระบุใช้ default ทั้งหมด - ติดตั้งใหม่ไม่ต้องมีไฟล์ config ก็ทำงานได้ (`src/config.ts`, `resolveConfig()` deep-merge)
- **Content-level tracking API** - ตอบคำถาม "ผู้ใช้กำลังดู/อ่านอะไร อยู่":
  - `client.view(userId, { contentType, contentId, title, url })` บันทึกว่าผู้ใช้กำลังดู content อะไร (page/article/image/video/component)
  - `client.watch(userId, view)` คืน `DwellTracker` - `start()` เมื่อ content ปรากฏ, `stop()` เมื่อหายไป พร้อมวัด dwell time (อ่าน/ดูอยู่นานเท่าไร) และ `visibleRatio`
  - เหตุการณ์แบบ convention: `content_view` + `content_time`
- **Content engagement analysis** - `computeContentEngagement()` รวมยอด views, unique viewers, total/avg dwell time ต่อ content item และต่อ type, เข้าไปอยู่ใน `analyze()`, รายงาน CLI, narrative และ payload ที่ส่งให้ LLM
- **`uba view` CLI command** - บันทึก content view จาก script/server: `uba view /blog/x --user u1 --type article --title "..." --dwell 45000`
- **`uba version` CLI command** - แสดงเวอร์ชันปัจจุบันและประวัติ patchUpdates ทั้งหมดจากในโค้ด
- **CHANGELOG.md และ in-code version registry** (`src/version.ts`) ตามรูปแบบ `patchUpdates` ของโปรเจกต์

### Improved

- **Batched writes** - `trackBatch()` เขียน JSONL ครั้งเดียวทั้งก้อน หรือ commit SQLite transaction เดียว แทนการเขียนทีละ event (demo 2,500+ events เร็วขึ้นชัดเจน)
- **CLI โหลด config ที่บันทึกไว้** - คำสั่ง CLI ทุกตัวอ่าน `uba.config.json` จาก data dir ก่อน ทำให้ถ้าผู้ใช้ตั้ง sqlite ไว้ CLI จะใช้ sqlite ตาม (เดิมใช้ default เสมอ)

## 0.1.0 - 2026-09-10

### Added (feat)

- Initial release: event tracking ด้วย JSONL persistence, gap-based sessionization (30 นาที), overview/funnel/retention metrics
- Anomaly detection ด้วย robust z-score บน daily event volume และ daily active users (flag ทั้ง spike และ drop)
- Behavioral segmentation ด้วย seeded k-means บน normalized per-user features, ติดป้าย Power / Regular / Casual-At-Risk
- Rule-based insight engine พร้อม severity levels ทำงาน offline 100%
- Optional LLM narrative reports ผ่าน OpenAI-compatible endpoint ใดๆ พร้อม graceful offline fallback
- CLI (`uba`): init, demo, track, import, analyze, report, clear และ deterministic demo data generator
