# Changelog

บันทึกการทำงานทุกรุ่นของ uba-ai ตามกฎ pre-deploy ของโปรเจกต์: bump version ใน `package.json` และ `src/version.ts` พร้อมบันทึก additions/fixes/improvements ใน `patchUpdates` ก่อน publish ทุกครั้ง

แหล่งข้อมูลในโค้ด: `src/version.ts` (`version` + `patchUpdates`) - ดูจาก CLI ได้ด้วย `uba version`

## 0.3.0 - 2026-09-10

### Breaking change: async API

ทุก method ที่เขียนลง/อ่านจาก storage ตอนนี้คืน Promise - ตามแผน [IMPROVEMENT_PLAN](IMPROVEMENT_PLAN.md) ข้อ P1 เพื่อให้ remote SQL backend (Postgres/MySQL adapter) implement ได้โดยไม่ต้องมี API สองชุด สิ่งที่เปลี่ยน:

- `EventStore`/`UBAClient`: `init`, `track`, `trackBatch`, `view`, `events`, `analyze`, `report`, `clear`, `close` เป็น async ทั้งหมด (เติม `await` ข้างหน้า)
- `DwellTracker.start()/stop()` เป็น async
- `analyze()` รับทั้ง object (`analyze({ funnelSteps, since, until })`) และ array เดิม (`analyze(["signup", "purchase"])`)

```ts
// ก่อน (v0.2)                    // หลัง (v0.3)
uba.init();                       await uba.init();
uba.track({...});                 await uba.track({...});
const r = uba.analyze();          const r = await uba.analyze();
dwell.start(); dwell.stop();      await dwell.start(); await dwell.stop();
```

### Added (feat)

- **Time-windowed analysis** - `analyze({ since, until })` / `report({...})` จำกัดช่วงเวลาที่วิเคราะห์ และ window ถูก push ลงชั้น storage: backend SQLite แปลงเป็น `WHERE timestamp >= ? AND timestamp < ?` บน index โดยตรง (memory ไม่โตตามขนาด dataset) ส่วน JSONL กรองตอน parse - `until` เป็น exclusive ทั้งสอง backend
- **CLI time windows** - `uba analyze --since 7d --until 2026-09-01` และ `uba report` รับเหมือนกัน รองรับ relative duration (`30m`, `24h`, `7d`), ISO date/datetime และ epoch ms
- `UBAClient.close()` - ปล่อย resource ของ storage (ปิด SQLite handle) จาก client โดยตรง

### Improved

- `analyze()` รับ `AnalyzeOptions` object; รูปแบบเดิมที่ส่ง array ของ funnel steps ยังใช้ได้

## 0.2.1 - 2026-09-10

### Added (feat)

- **Data schema versioning** ([src/schema.ts](src/schema.ts)) - dataset ทุกชุดมี schema version: SQLite stamp ผ่าน `PRAGMA user_version`, JSONL ผ่าน field `schemaVersion` ใน `uba.config.json` พร้อม forward-only migration runner แบบ transactional (ตามกฎ database ของโปรเจกต์: ไม่แก้ migration ที่ apply แล้ว เพิ่มไฟล์ใหม่เท่านั้น) - วางรากไว้ก่อนมีข้อมูลผู้ใช้จริงเยอะ เพื่อการ migrate อนาคตไม่เจ็บ

### Build

- **CI pipeline (GitHub Actions)** - matrix Node 20/22/24 x ubuntu/windows: strict build ทุกคู่, full test suite บน Node 22+ (type stripping), dist smoke test บน Node 20 (รวม content view + analyze), guard ยืนยันว่า sqlite backend บน Node เก่า fail ด้วยข้อความสุภาพไม่ใช่ crash, และ `npm pack --dry-run` ตรวจความสมบูรณ์ของ tarball
- **Machine-enforced pre-deploy rule** - `scripts/check-version.mjs` ตรวจว่า package.json, `src/version.ts` (`version`) และ `patchUpdates` ตรงกันทุกจุด รันใน CI ทุก push และใน `prepublishOnly` - เวอร์ชันไม่ sync จะ publish ไม่ผ่านตั้งแต่ต้นทาง

### Docs

- [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md) - รายงานปรับปรุงหลัง v0.2.0: async storage interface, windowed query + SQL pushdown, browser SDK, uba serve, ลำดับ release v0.2.1-v0.5.x และมติเรื่อง SQL backend (SQLite = core, remote DB = adapter แยก)
- [docs/BMC_PRICING.md](docs/BMC_PRICING.md) - Business Model Canvas + แผนราคา 6 ช่องทางรายได้

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
