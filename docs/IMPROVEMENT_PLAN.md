# uba-ai Improvement Report - แผนปรับปรุงหลัง v0.2.0

Date: 2026-09-10
Active version: v0.2.0 (npm ยังค้างที่ v0.1.0 - รอ publish ผ่าน OTP ของผู้ใช้)
เอกสารนี้อ้างอิงจากการประเมินจุดอ่อนเชิงสถาปัตยกรรมและ roadmap ธุรกิจใน [BMC_PRICING.md](BMC_PRICING.md)

---

## 1. สรุปสภาพปัจจุบัน

สิ่งที่แข็งแรงแล้ว:

- Pipeline วิเคราะห์ครบ (session -> metrics -> funnel -> retention -> anomaly -> segment -> insight -> narrative)
- Zero dependencies จริงทั้ง JSONL และ SQLite (ผ่าน node:sqlite ในตัว Node)
- Config แยกส่วนมี default ครบ, deterministic segmentation, graceful LLM fallback
- Tests 18/18, strict TypeScript, เอกสารครบ (README/CHANGELOG/REPORT/BMC)

จุดอ่อนเชิงโครงสร้างที่ต้องแก้ก่อนโต (เรียงตามความเสี่ยง):

| อันดับ | ปัญหา | ผลถ้าไม่แก้ |
| --- | --- | --- |
| 1 | Storage interface เป็น synchronous ทั้งหมด | ต่อ remote DB (Postgres/MySQL) ไม่ได้โดย design - ยิ่งปล่อยนานยิ่ง breaking |
| 2 | ทุก analysis โหลด event ทั้ง dataset เข้า memory (`readAll()`) | พังที่หลักล้าน events, SQLite ที่อุตส่าห์ใส่ index ไม่ได้ถูกใช้เพราะลากข้อมูลออกมาย่อยฝั่ง JS |
| 3 | ไม่มี CI | regression หลุดได้ทุก release, ไม่มีหลักฐานว่า Node 20 (jsonl) กับ Node 22.5+ (sqlite) ทำงานพร้อมกัน |
| 4 | dwell tracking ต้องเขียน start/stop เอง ไม่มี browser SDK | ผู้ใช้จริงส่วนใหญ่อยู่บนเว็บ - friction นี้คือตัวฉุด npm download ตามแผนเฟส 1 |
| 5 | ตาราง events ไม่มี schema version | migrate อนาคตจะเจ็บและเสี่ยงข้อมูลผู้ใช้ |
| 6 | รับ event ได้แค่ใน process เดียว | ใช้เป็น collector หลายเครื่อง/หลายแอปไม่ได้ - ต่อยอด Cloud ไม่ได้ |

## 2. แผนปรับปรุงรายข้อ

### P1 - Async storage interface (เป้า: v0.3.0, breaking)

ปัญหา: `EventStorage.readAll(): UBAEvent[]` เป็น sync ซึ่งถูกสำหรับ local file แต่ remote SQL ทุกตัวเป็น async การยัด driver เข้า interface sync คือผิดตั้งแต่ราก

แนวทาง:

- เพิ่ม `AsyncEventStorage` (append/appendMany/readAll/close คืน Promise) เป็น contract หลักตัวใหม่
- `UBAClient.analyze()/report()` เปลี่ยนเป็น async (report เป็น async อยู่แล้ว - เหลือ analyze)
- JsonlStorage/SqliteStorage implement ทั้งสอง interface (sync wrapper คงไว้ 1 เวอร์ชันแล้ว deprecate)
- Export interface ให้ third-party เขียน adapter เองได้ (เช่น @uba-ai/pg อนาคต)

Impact analysis (ตามกฎ cross-component): ผู้ถูกกระทบคือ EventStore, UBAClient, CLI (ทุกคำสั่ง analyze/report/import), tests ทั้งหมด, README - ต้องอัปเดตพร้อมกันใน release เดียว

### P2 - Windowed query + aggregate pushdown (เป้า: v0.3.0)

ปัญหา: analyze() โหลดทั้ง dataset เข้า memory

แนวทาง:

- เพิ่ม `analyze({ since, until, limit })` - กรองที่ชั้น storage ไม่ใช่ใน JS
- SqliteStorage: ดัน COUNT/GROUP BY ลง query (topEvents, dailyActivity คำนวณด้วย SQL ได้เลย) - index ที่มีอยู่จะถูกใช้จริง
- ระยะยาว: backends ใหญ่ (ClickHouse ใน cloud tier) ได้ประโยชน์จาก pattern เดียวกัน

### P3 - CI ด้วย GitHub Actions (เป้า: ทันที - เร็วสุด ผลคุ้มสุด)

แนวทาง:

- Workflow: Node matrix 20 / 22 / 24 x (ubuntu, windows) รัน `tsc` strict + `node --test`
- เทสต์เพิ่ม: ยืนยันว่าบน Node 20 backend jsonl ทำงานปกติ และ sqlite fail ด้วย error message ที่เข้าใจได้ (ไม่ใช่ crash)
- Gate การ publish: `npm pack --dry-run` + ตรวจ version sync ระหว่าง package.json กับ src/version.ts อัตโนมัติ (บังคับกฎ pre-deploy ด้วยเครื่อง ไม่ใช่ความจำคน)

### P4 - Browser SDK (เป้า: v0.4.0 - ผลทางธุรกิจชัดสุด)

แนวทาง:

- Package แยก `@uba-ai/browser` (bundle เล็ก ไม่มี dependency) ส่ง event เข้า endpoint ของ collector (P6) หรือเก็บลง queue แล้ว flush เป็น batch
- Auto-wire: pageview ทุก route change (History API), dwell time ต่อ element ผ่าน IntersectionObserver + visibilitychange, click/scroll depth แบบ opt-in
- `sendBeacon` ตอน tab ปิด เพื่อไม่ให้ dwell สุดท้ายหาย
- ฝั่งวิเคราะห์ไม่ต้องแก้: SDK ผลิต event ตาม convention content_view/content_time ที่มีอยู่แล้ว

### P5 - Schema versioning + migration (เป้า: v0.3.0 - เล็กแต่ต้องทำก่อนมีข้อมูลผู้ใช้เยอะ)

แนวทาง:

- เพิ่มตาราง/field `schema_version` ทั้ง SQLite (PRAGMA user_version) และ marker ใน uba.config.json ฝั่ง JSONL
- Migration runner แบบไปข้างหน้าอย่างเดียว (ตามกฎ D1 ของโปรเจกต์: ไม่แก้ migration ที่ apply แล้ว, เพิ่มไฟล์ใหม่เท่านั้น)

### P6 - HTTP ingest mode: uba serve (เป้า: v0.4.0)

แนวทาง:

- `uba serve --port 3001` เปิด POST /events รับ batch จาก SDK/หลายเครื่อง เขียนลง storage ที่ config ไว้
- Auth แบบง่ายก่อน (shared token ใน config) แล้วค่อยเป็น multi-tenant ใน cloud tier
- นี่คือก้อนพื้นฐานเดียวกับที่ uba-ai Cloud เฟส 3 จะใช้ - ทำครั้งเดียวได้สองต่อ

## 3. เรื่อง SQL backend: มติที่สรุปแล้ว

- **JSONL = default ตลอดไป** สำหรับผู้ใช้เริ่มใหม่ (zero setup คือจุดขาย)
- **SQLite = "SQL อย่างเป็นทางการ" ของ core** - เพียงพอถึงหลักล้าน events เมื่อมี P2 (pushdown) รองรับ และตรงปรัชญา zero-dependency
- **Postgres/MySQL = adapter package แยก** (`@uba-ai/pg`) ต้องเกิดหลัง P1 (async interface) เท่านั้น ไม่เข้า core เพราะลาก driver dependency
- **ClickHouse/DuckDB/BigQuery = เรื่องของ cloud tier** ไม่ใช่งานฝั่ง self-hosted package

## 4. ลำดับงานและเวอร์ชันเป้าหมาย

| Release | ของที่ออก | เหตุผลของลำดับ |
| --- | --- | --- |
| v0.2.1 | P3 (CI) + P5 (schema version) | เล็ก เสี่ยงต่ำ กันพังให้ release ถัดไป |
| v0.3.0 | P1 (async) + P2 (windowed/pushdown) | breaking ก้อนเดียวจบ ก่อนมีผู้ใช้ external เยอะ - ยิ่งช้ายิ่งแพง |
| v0.4.0 | P4 (browser SDK) + P6 (uba serve) | เปิดตลาดเว็บจริง + ปูทาง Cloud ตาม BMC เฟส 1-2 |
| v0.5.x | Pro features (path analysis, cohort heatmap, scheduled reports) | เริ่มเก็บรายได้ตาม BMC เฟส 2 |

หมายเหตุการ publish: ทุก release ต้อง bump version ใน package.json + src/version.ts + CHANGELOG.md ตามกฎ pre-deploy และ npm publish ต้องผ่าน OTP ของเจ้าของบัญชี (ขั้นตอนเดียวที่ทำแทนไม่ได้)

## 5. ตัวชี้วัดความสำเร็จ

- P1/P2: analyze dataset 1 ล้าน events บน SQLite จบในไม่กี่วินาที, memory ไม่โตตามขนาด dataset (วัดด้วย --max-old-space-size ต่ำๆ ในเทสต์)
- P3: ทุก commit มีสถานะ build x platform x Node version มองเห็นบน GitHub
- P4: ติดตั้ง SDK ด้วยโค้ดไม่เกิน 5 บรรทัดได้ dwell time จริงโดยไม่ต้องเขียน IntersectionObserver เอง
- P6: สองเครื่องยิง event เข้า collector เดียวแล้ว analyze เห็นครบ

## 6. สิ่งที่ไม่ทำ (explicit non-goals)

- ไม่ใส่ Postgres/MySQL/ClickHouse driver เข้า core - ทำลาย zero-dependency ที่เป็นจุดขายหลัก
- ไม่ทำ real-time streaming dashboard ใน package (เป็นงานของ cloud tier)
- ไม่เปลี่ยน license ของ core - MIT ถาวร เพราะคือ acquisition engine ของทุกช่องทางรายได้ตาม BMC
