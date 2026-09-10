# Work & Version Report - uba-ai v0.1.0

Date: 2026-09-10
Package: `uba-ai` v0.1.0 (standalone npm package - ไม่ใช่ส่วนหนึ่งของ ARLAY frontend จึงไม่มี `src/app/version.ts` ที่ต้อง sync)
License: MIT

## 1. เป้าหมายของงาน

สร้าง User Behavior Analytics AI เป็น npm package ที่ผู้ใช้ติดตั้งแล้วใช้งานได้ทันที (zero setup, zero dependencies) รองรับทั้งการใช้งานเป็น library ในโค้ดและ CLI จากเทอร์มินัล พร้อมชั้น AI ที่สร้างรายงานเชิงพฤติกรรมได้ทั้งแบบ offline และผ่าน LLM จริง

## 2. สถาปัตยกรรมและ Root Cause ของการออกแบบ

Pipeline ทำงานเป็นชั้นๆ จากข้อมูลดิบสู่ insight:

```
events.jsonl (store) -> sessionize -> metrics (overview/funnel/retention)
                                   -> anomaly detection (z-score)
                                   -> segmentation (k-means)
                                   -> insight engine (rule-based)
                                   -> narrative (offline template หรือ LLM)
```

การตัดสินใจเชิงออกแบบที่สำคัญ:

- **JSONL append-only storage**: ไม่ต้องมีฐานข้อมูล ติดตั้งแล้วใช้ได้ทันที ตรวจสอบ/ลบไฟล์ได้ง่าย และทนต่อ partial write (ข้ามบรรทัดที่พังโดยไม่ brick ทั้ง dataset)
- **Anomaly detection แบบ z-score แทน ML model**: อธิบายผลได้ (mean/std/z), รันทันที, เหมาะกับ series สั้นระดับรายวัน; ตรวจทั้ง spike และ drop เพราะกิจกรรมที่หายกะทันหันมักเร่งด่วนกว่ายอดที่พุ่ง
- **k-means แบบ seeded PRNG (mulberry32)**: ผล segmentation นิ่งและทำซ้ำได้ทุก run ไม่กระโดดไปมาระหว่างการวิเคราะห์สองครั้ง ซึ่งสำคัญต่อการเปรียบเทียบเชิงผลิตภัณฑ์
- **LLM narrative เป็น optional layer**: insight engine แบบ rule-based ทำงานได้ครบโดยไม่ต้องมี API key และถ้า LLM call ล้มเหลว/timeout จะ fallback กลับ offline narrative อัตโนมัติ ผู้ใช้จึงได้รายงานเสมอ
- **Node type stripping**: source ใช้ import specifier แบบ `.ts` และตั้ง `rewriteRelativeImportExtensions` ใน tsconfig ทำให้รันเทสต์ตรงจาก TypeScript ได้ ขณะที่ dist ที่ publish เป็น `.js` ตามปกติ

## 3. สิ่งที่ได้ส่งมอบ

| ความสามารถ | รายละเอียด |
| --- | --- |
| Event tracking | `track()` / `trackBatch()` พร้อม id + timestamp อัตโนมัติ |
| Sessionization | inactivity gap 30 นาที (ตั้งค่าได้) เขียน sessionId กลับเข้า event |
| Metrics | overview, top events, daily activity, funnel แบบเรียงลำดับเวลา, day-N retention |
| Anomaly detection | robust z-score บน daily_events และ daily_active_users (threshold ตั้งค่าได้, ขั้นต่ำ 5 จุดข้อมูล) |
| Segmentation | k-means บน 5 features ต่อ user, min-max normalized, ติดป้าย Power / Regular / Casual-At-Risk |
| Insight engine | rule-based findings พร้อม severity (info/warning/critical) ครอบคลุม engagement, funnel, retention, anomaly, segmentation |
| AI narrative | OpenAI-compatible endpoint ใดๆ (OpenAI, OpenRouter, Workers AI, Ollama) ผ่าน `UBA_AI_API_KEY` + graceful fallback |
| CLI | `uba init/demo/track/import/analyze/report/clear` พร้อม `--dir`, `--json`, `--funnel`, `--ai` |
| Demo data | generator แบบ deterministic สร้างผู้ใช้ 3 archetype + ฝัง spike day ไว้ให้ anomaly detection จับได้ |

## 4. ไฟล์ทั้งหมดที่สร้าง

Entry points และ API:

- [package.json](package.json) - metadata, bin `uba`, scripts, zero runtime dependencies
- [tsconfig.json](tsconfig.json) - strict mode, NodeNext, `rewriteRelativeImportExtensions`
- [src/index.ts](src/index.ts) - public API: `createUBAClient()`, `UBAClient`, re-exports ทุก layer
- [src/cli.ts](src/cli.ts) - CLI entry (bin) พร้อม arg parser และ human-readable/JSON output

Core pipeline:

- [src/types.ts](src/types.ts) - type definitions ทั้งหมด (UBAEvent, Session, AnalysisReport, ...)
- [src/store.ts](src/store.ts) - EventStore (JSONL persistence + config)
- [src/sessionizer.ts](src/sessionizer.ts) - sessionize ด้วย inactivity gap
- [src/metrics.ts](src/metrics.ts) - computeOverview / computeFunnel / computeRetention / dayKey

AI layer:

- [src/anomaly.ts](src/anomaly.ts) - detectAnomalies (z-score พร้อม densify series ให่วันเงียบเป็น 0)
- [src/segment.ts](src/segment.ts) - extractUserFeatures / kmeans / segmentUsers
- [src/insights.ts](src/insights.ts) - generateInsights (rule engine) + formatDuration
- [src/ai.ts](src/ai.ts) - generateNarrative (LLM) + buildOfflineNarrative (fallback)

เครื่องมือและเอกสาร:

- [src/demo.ts](src/demo.ts) - generateDemoEvents
- [test/analyze.test.ts](test/analyze.test.ts) - เทสต์ sessionizer, funnel, retention, overview, anomaly, segmentation, insights
- [test/client.test.ts](test/client.test.ts) - เทสต์ end-to-end: persistence, analyze(), offline narrative, demo generator
- [README.md](README.md) - คู่มือการใช้งานเต็มรูปแบบ
- [LICENSE](LICENSE) - MIT
- [SAMPLE_ANALYSIS_REPORT.md](SAMPLE_ANALYSIS_REPORT.md) - ตัวอย่างรายงานวิเคราะห์จริงจาก demo data

## 5. ปัญหาที่เจอระหว่างทางและวิธีแก้

1. **Node type stripping ไม่ rewrite specifier `.js` -> `.ts`** - ตอนรัน `node --test` ตรงจาก src จะพบ `ERR_MODULE_NOT_FOUND` แก้โดยเปลี่ยน relative imports ทั้งหมดใน src เป็น `.ts` และเปิด `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` เพื่อให้ tsc emit เป็น `.js` ใน dist ตามเดิม
2. **`node --test test/` บน Windows ตีความ `test/` เป็น module path** - แก้ script เป็น `node --test` เฉยๆ ให้ test runner ค้นหาไฟล์เทสต์เอง
3. **Expectation ของ funnel test ผิด** - เคสที่ user ทำ checkout ก่อน signup ต้องนับว่าผ่าน step signup (เพราะยิง event signup จริง) ทำให้ `reachedUsers` เป็น 3 ไม่ใช่ 2 แก้ expectation ในเทสต์ให้ตรงกับ semantics ที่ถูกต้อง
4. **`process`/`fetch`/`console` ไม่รู้จักตอน build** - ติดตั้ง `@types/node` เป็น devDependency

## 6. ผลการตรวจสอบ (Verification)

- TypeScript strict build: `tsc -p tsconfig.json` ผ่าน 0 errors (clean rebuild จาก dist ที่ลบแล้ว)
- Unit/integration tests: ผ่าน 10/10 (`node --test`)
- CLI smoke test ครบวงจร: init -> demo -> track -> analyze -> report -> import path ทำงานถูกต้อง ตรวจพบ spike ที่ฝังไว้ใน demo data และแบ่ง segment ตรงตาม archetype ที่ generate
- `npm pack --dry-run`: tarball 31.6 kB, 45 ไฟล์, พร้อม publish
- ตรวจสอบแล้วไม่มี emoji ในโค้ด คอมเมนต์ และเอกสาร ตามกฎของโปรเจกต์

## 7. ขั้นตอนเผยแพร่

```bash
cd "E:\software\Alenout Project\uba-ai"
npm publish        # prepublishOnly จะรัน build ให้อัตโนมัติ
```

หมายเหตุ: ตรวจสอบชื่อ `uba-ai` บน npm registry ก่อน publish ว่ายังไม่ถูกจอง ถ้าชนกันให้เปลี่ยนชื่อใน package.json และ README แล้ว publish ใหม่

## 8. ต่อยอดในอนาคต (ยังไม่รวมใน v0.1.0)

- Streaming ingest ผ่าน HTTP endpoint (ปัจจุบันเป็น file-based)
- Path analysis / Markov transition ระหว่าง events
- Cohort retention แบบ bounded (แยกตามวันที่ผู้ใช้เข้ามาครั้งแรก)
- Export รายงานเป็น HTML/PDF

---

# Work & Version Report - uba-ai v0.2.0

Date: 2026-09-10
Active version: `0.2.0` - sync แล้วทั้งใน [package.json](package.json) และ [src/version.ts](src/version.ts) (ค่าคงที่ `version` + `patchUpdates`) และบันทึกใน [CHANGELOG.md](CHANGELOG.md)

## 1. เป้าหมายของรอบนี้

ต่อยอดจากคำถามของผู้ใช้ 3 ข้อ: (1) ต่อ SQL ได้ไหม (2) ให้ผู้ใช้ตั้งค่าแยกเป็น .json โดยมี default ให้ครบ (3) เก็บข้อมูลละเอียดแค่ไหน - รู้ได้ไหมว่าผู้ใช้กำลังดูส่วนไหน กำลังอ่านอะไร เห็นภาพอะไร

## 2. สิ่งที่เพิ่มใน v0.2.0

### Storage layer ต่อ SQL ได้ (ยังคง zero dependencies)

- Interface `EventStorage` ใหม่ใน [src/storage.ts](src/storage.ts) แยก persistence ออกจาก logic
- `JsonlStorage` - พฤติกรรมเดิม (default) ย้ายออกจาก store มาอยู่ชั้น storage พร้อม batched write (append ครั้งเดียวทั้งก้อนแทนทีละบรรทัด)
- `SqliteStorage` - SQL backend ใช้ `node:sqlite` ที่ build-in มากับ Node (>= 22.5) จึงไม่ต้องเพิ่ม dependency ภายนอกเลย: ตาราง `events` พร้อม index บน timestamp/user_id/event, properties เก็บเป็น JSON text column, bulk import รันใน transaction เดียว, โหลด module แบบ lazy เพื่อไม่ให้ผู้ใช้ Node 20 บน backend jsonl ได้รับผลกระทบ และมี error message ชัดเจนถ้า Node เก่าเกินไปแล้วเลือก sqlite
- เพิ่ม `close()` ใน interface - จำเป็นบน Windows เพราะ handle ของ SQLite ที่เปิดค้างจะล็อกไฟล์ (เจอจริงตอนเทสต์: EPERM ตอนลบ temp dir)

### Config แยกส่วนใน .json พร้อม default ครบ

- [src/config.ts](src/config.ts): `UBAConfig` แบ่งเป็น section (`storage`, `ai`, analysis settings) ทุก field มี default ใน `DEFAULT_CONFIG` และ `resolveConfig()` deep-merge ราย field - ตั้ง `{"storage":{"backend":"sqlite"}}` เฉยๆ ก็ได้ `sqliteFile` default มาด้วย
- CLI ทุกคำสั่งตอนนี้โหลด `uba.config.json` จาก data dir ก่อน (ผ่าน `EventStore.loadFrom`) - เดิม CLI ใช้ default เสมอ ซึ่งจะทำให้ผู้ใช้ที่ตั้ง sqlite ไว้แต่ CLI อ่าน jsonl
- บันทึก config ทั้งหมดลง `<dataDir>/uba.config.json` ตอน `uba init` ผู้ใช้แก้ไฟล์นี้ได้เลย

### Content-level tracking: รู้ว่าผู้ใช้กำลังดูอะไร อ่านอะไร เห็นภาพอะไร

- [src/content.ts](src/content.ts): convention event คู่ `content_view` (content ปรากฏ) + `content_time` (content หายไป พร้อม `dwellMs` และ optional `visibleRatio`)
- API ฝั่งผู้ใช้: `client.view(userId, { contentType, contentId, title, url })` แบบ one-shot และ `client.watch(...)` คืน `DwellTracker` ที่ `start()`/`stop()` จับเวลาระหว่างที่ผู้ใช้มอง content นั้นอยู่ (ใน browser ผูกกับ IntersectionObserver / route change / visibilitychange ได้เลย)
- `computeContentEngagement()` rollup ต่อ item (views, unique viewers, total/avg dwell, title) และต่อ type (article/image/page/video) - เข้าไปอยู่ใน `AnalysisReport.content`, ส่วน CONTENT ENGAGEMENT ของ `uba analyze`/`uba report`, payload ที่ส่งให้ LLM และกฎใหม่ใน insight engine (content ที่ดึง attention มากสุด, content ที่ views สูงแต่ไม่มีการวัด dwell = warning)
- CLI ใหม่: `uba view <contentId> --user <id> [--type ...] [--title ...] [--dwell ms]`
- demo generator สร้าง content events ด้วย (product hero image ทุกการดูสินค้า + blog article สำหรับ power users) ทำให้ `uba demo` แสดงชั้น content ทันที

### ระบบบันทึกการทำงาน + version

- [src/version.ts](src/version.ts): `version` + `patchUpdates` (VersionRecord ต่อ release, แยกรายการ feat/fix/improve/docs/build) ตามรูปแบบ `src/app/version.ts` ของ ARLAY - เป็น single source of truth ในโค้ด
- คำสั่งใหม่ `uba version` แสดงเวอร์ชันปัจจุบันและประวัติ patch ทั้งหมด
- [CHANGELOG.md](CHANGELOG.md) บันทึก v0.1.0 และ v0.2.0 ละเอียด

## 3. การตรวจสอบ (Verification)

- `tsc -p tsconfig.json` strict mode: ผ่าน 0 errors
- Tests: ผ่าน 18/18 (เพิ่ม 8 ตัวใหม่: SQLite round-trip เทียบ JSONL, backend selection จาก config + reopen, resolveConfig deep-merge, factory, viewEvent, DwellTracker start/stop/no-op, content engagement aggregation, end-to-end client.watch -> analyze -> insights)
- CLI smoke test บน SQLite backend จริง: init -> แก้ config เป็น sqlite -> demo 2,118 events -> `uba view` พร้อม dwell -> analyze แสดง CONTENT ENGAGEMENT ถูกต้อง -> `uba version` แสดง patchUpdates ครบ
- ปัญหาที่เจอและแก้ระหว่างทาง: (1) Node strip-only ไม่รองรับ constructor parameter properties ใน `DwellTracker` - เปลี่ยนเป็น explicit fields (2) EPERM ตอนลบ temp dir บน Windows เพราะ SQLite handle เปิดค้าง - เพิ่ม `close()` และย้ายเข้า finally ในเทสต์ (3) expectation ใน storage test ชี้ index ผิดหลัง readAll เริ่ม sort ตาม timestamp

## 4. Cross-component impact

- `AnalysisReport` เพิ่ม field `content` - consumers ที่อัปเดตแล้ว: insights.ts, ai.ts (narrative + LLM payload), cli.ts (printAnalysis), index.ts (analyze), tests ทุกตัวที่สร้าง report literal
- `UBAConfig` ย้ายจาก types.ts ไป config.ts - types.ts re-export ไว้เพื่อไม่ให้ import เดิมพัง, index.ts export ทั้งจาก config.ts โดยตรง
- `EventStore` API เดิมคงครบ (track/trackBatch/readAll/clear/init/loadFrom) เพิ่ม `storage`, `close()` - โค้ดผู้ใช้ v0.1 ไม่ต้องแก้

## 5. ค้างไว้รอผู้ใช้

- npm publish v0.2.0 ต้องใช้ OTP ของผู้ใช้ (เหมือนรอบ v0.1.0) - โค้ดพร้อม publish แล้ว
