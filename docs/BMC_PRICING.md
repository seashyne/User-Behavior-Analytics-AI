# uba-ai Business Model Canvas & Pricing Report

Date: 2026-09-10
Package: uba-ai v0.2.0 (npm + GitHub, MIT)
สถานะปัจจุบัน: เปิดให้ใช้ฟรี 100% แบบ open source - เอกสารนี้วางแผนว่าจะ "ขายอะไรได้บ้าง" รอบๆ ผลิตภัณฑ์นี้

---

## 1. Business Model Canvas

### 1.1 Value Propositions (คุณค่าที่เรามอบให้)

| กลุ่มคุณค่า | รายละเอียด |
| --- | --- |
| Privacy-first analytics | ข้อมูลพฤติกรรมผู้ใช้เก็บในเครื่อง/เซิร์ฟเวอร์ของลูกค้าเอง ไม่ส่งผ่าน third party - ขายจุดนี้ได้แรงในยุค GDPR/PDPA |
| Zero setup, zero dependency | `npm install` ตัวเดียวจบ ไม่มี database, ไม่มี SDK หลายตัว, ไม่มี vendor lock-in |
| AI insights ในตัว | anomaly detection + segmentation + insight engine ทำงาน offline ได้เลย ไม่ต้องมี data scientist |
| Content-level attention | รู้ว่าผู้ใช้ "กำลังดูอะไร อ่านอะไร นานเท่าไร" (dwell time) ซึ่ง tool ฟรีส่วนใหญ่ไม่ให้ได้ |
| ต่อ SQL ได้ | ข้อมูลอยู่ใน SQLite/JSONL ของลูกค้า - ย้าย/backup/join กับข้อมูลอื่นได้ง่าย |

### 1.2 Customer Segments (ลูกค้าเป้าหมาย)

1. **Indie developers / startup เล็ก** - อยากได้ product analytics แบบ self-hosted ไม่อยากจ่าย Mixpanel/Amplitude
2. **บริษัทที่ติดข้อจำกัด PDPA/GDPR** - ห้ามส่งข้อมูลผู้ใช้ออกนอก infra ของตัวเอง (ธนาคาร, สุขภาพ, หน่วยงานรัฐ)
3. **Agency / dev shop** - ทำเว็บ/แอปให้ลูกค้าหลายราย อยากฝัง analytics ให้ลูกค้าโดยไม่จ่ายต่อหัว
4. **ทีม AI/data ที่ต้องการ raw behavior data** - เอา event stream ไปต่อ model ของตัวเอง
5. **ผู้สอน/คอร์สเรียน product analytics** - ใช้เป็นเครื่องมือสอนเพราะติดตั้งง่าย อ่านโค้ดได้

### 1.3 Channels

- npm registry (ค้นเจอผ่าน keyword: analytics, user-behavior, product-analytics)
- GitHub (SEO + trending + topics)
- เนื้อหาเทคนิค (blog, dev.to, X/Twitter, Reddit r/node r/analytics)
- Product Hunt / Hacker News launch ของเวอร์ชัน cloud
- Marketplace ของ framework (Vercel Integrations, Cloudflare Workers templates)

### 1.4 Customer Relationships

- Free tier: community support ผ่าน GitHub issues
- Paid: SLA support, private channel, onboarding call
- Enterprise: dedicated success engineer, custom integration

### 1.5 Revenue Streams (เราจะขายอะไรได้บ้าง - หัวใจของรายงาน)

ดูรายละเอียดเต็มในข้อ 2 ด้านล่าง สรุป 6 ช่องทาง:

1. **uba-ai Cloud (SaaS)** - hosted ingestion + dashboard
2. **Pro license (open-core)** - ฟีเจอร์ขั้นสูงใน package
3. **AI Reports add-on** - LLM insight แบบ managed
4. **Enterprise self-hosted license + support**
5. **White-label / OEM สำหรับ agency**
6. **บริการ: setup, consulting, custom integration**

### 1.6 Key Resources

- Codebase uba-ai (MIT) + แบรนด์บน npm
- ความรู้ domain: product analytics + ML แบบเบา (z-score, k-means)
- โครงสร้างพื้นฐาน cloud (ถ้าทำ SaaS): Workers/R2/D1 ตาม stack ที่ทีมถนัดอยู่แล้ว (Alenout/cloud-native)

### 1.7 Key Activities

- พัฒนา core package ต่อเนื่อง (path analysis, cohort, real-time)
- สร้าง hosted layer: collector endpoint, dashboard, billing
- การตลาดเนื้อหา (เขียน benchmark เปรียบเทียบ, use case PDPA)
- Support ลูกค้า paid

### 1.8 Key Partnerships

- Framework ecosystems (Vercel, Cloudflare, Express/Fastify middleware เป็น official templates)
- LLM providers (OpenRouter / Workers AI เป็น default option ใน AI add-on)
- Agency partners ที่ซื้อ white-label

### 1.9 Cost Structure

- แรงพัฒนาหลัก (code + docs + support)
- Infra ของ cloud tier: ingestion + storage + LLM token (pass-through + margin)
- เครื่องมือ billing (Stripe / Paddle)
- ต้นทุนแปรผันส่วนใหญ่คือ LLM tokens และ event storage ของ SaaS

---

## 2. เราจะขายอะไรได้บ้าง - รายละเอียดแต่ละช่องทาง

### 2.1 uba-ai Cloud (SaaS) - รายได้หลักที่ scalable ที่สุด

ตัว package ปัจจุบันเป็น local-first สิ่งที่ขายได้คือ "ไม่ต้องดูแลเอง":

- Hosted collector endpoint (`POST /events`) รับ event จากเว็บ/แอปโดยตรง
- Dashboard real-time: funnel, retention, segments, content engagement แบบ UI
- Alert เมื่อ anomaly detection เจอ spike/drop (email/Slack/webhook)
- Team features: หลายคนดูโปรเจกต์เดียวกัน, role

**จุดขายต่างจาก Mixpanel/Amplitude**: ราคาถูกกว่าชัดเจน + ยิง event ไม่จำกัด user (คิดตาม event ไม่ใช่ MTU) + มีโหมด "เก็บในเครื่องลูกค้าแล้ว sync เฉพาะตัวเลข aggregate" สำหรับคนติด PDPA

### 2.2 Pro license (open-core) - ขายฟีเจอร์บน package เดิม

Core (ฟรี, MIT) คงเดิมทั้งหมด สิ่งที่เลื่อนไปเป็น Pro (`uba-ai-pro` หรือ feature flag ด้วย license key):

| ฟีเจอร์ Pro | ทำไมคนยอมจ่าย |
| --- | --- |
| Real-time tail analysis (watch mode) | dashboard ในเทอร์มินัล/ฝังใน admin panel |
| Path analysis / Markov transitions | "ผู้ใช้ไปไหนต่อจากหน้า pricing" |
| Cohort retention แบบ bounded + heatmap | งานจริงของทีม growth |
| Multi-project ใน data dir เดียว | agency ดูแลหลายลูกค้า |
| Scheduled reports (cron -> email/Slack) | รายงานอัตโนมัติทุกเช้า |
| Export HTML/PDF + brand ของลูกค้า | agency ส่งงานลูกค้า |
| Predictive churn score จาก segment features | ขายทีมที่จริงจังเรื่อง retention |

โมเดลราคา: subscription ต่อ developer seat หรือต่อโปรเจกต์ - ต้นทุนของเราแทบเป็นศูนย์เพราะเป็นโค้ด ไม่ใช่ infra

### 2.3 AI Reports add-on - ขายความฉลาด ไม่ใช่ขาย token

ปัจจุบันผู้ใช้ใส่ API key เองได้ฟรี สิ่งที่ขายคือ managed version:

- ไม่ต้องมี key เอง - เราจ่าย LLM แล้วคิดค่าบริการรวม margin
- Prompt pack เฉพาะอุตสาหกรรม (e-commerce, SaaS, edtech)
- Executive summary รายสัปดาห์อัตโนมัติ + เปรียบเทียบสัปดาห์ก่อน
- "Ask your data": ถามเป็นภาษาคนแล้วได้คำตอบจาก dataset ของตัวเอง

คิดราคาแบบ credit pack (เช่น 100 รายงาน/เดือน) - ต้นทุนต่อรายงานด้วยโมเดลเล็กอยู่ที่เศษเสี้ยวของบาท ขายในราคาที่มี margin สูง

### 2.4 Enterprise self-hosted license + support

กลุ่ม PDPA/regulated ไม่ซื้อ SaaS แต่ซื้อ "ความมั่นใจ":

- License ต่อปีสำหรับใช้เชิงพาณิชย์ในองค์กร + indemnification
- SLA support (ตอบใน 4 ชม./1 วัน), security review docs, DPA template
- Custom deployment: Docker image, Kubernetes chart, ตัว collector ที่ scale แนวนอน
- On-prem LLM integration (Ollama/vLLM ในเครือข่ายลูกค้า) - รองรับอยู่แล้วเพราะใช้ได้กับ OpenAI-compatible endpoint ใดๆ

### 2.5 White-label / OEM สำหรับ agency

- License ที่ให้ agency ฝัง uba-ai (หรือ dashboard) ในผลิตภัณฑ์ที่ส่งลูกค้า โดยเปลี่ยนแบรนด์ได้
- คิดราคาแบบต่อ end-client หรือ flat ต่อปีไม่จำกัด client (ราคาสูงกว่า)
- Agency ได้ margin ต่อโดยไม่ต้องสร้าง analytics เอง

### 2.6 บริการ (services)

- Setup + integration กับ stack ของลูกค้า (Express/Next.js/Workers middleware)
- Custom event schema design + funnel workshop
- Custom development (connector เข้า warehouse, dashboard เฉพาะกิจ)
- Training คอร์ส product analytics ด้วย uba-ai

รายได้ไม่ scale แต่ margin สูงและแปลงเป็น case study สำหรับช่องทางอื่น

---

## 3. Pricing เปรียบเทียบกับตลาด (benchmark)

ราคาตลาดโดยประมาณของคู่แข่ง (ต่อเดือน):

| คู่แข่ง | Free tier | Paid เริ่มต้น | โมเดลคิดเงิน |
| --- | --- | --- | --- |
| Mixpanel | 1M events | ~$28+ (Growth) | ตาม event volume |
| Amplitude | 50k MTU | ~$49-61 (Plus) | ตาม monthly tracked users |
| PostHog Cloud | 1M events | usage-based ~$0.0003/event | ตาม event + feature flags ฯลฯ |
| Plausible Cloud | ไม่มี (self-host ฟรี) | ~EUR 9 (10k pageviews) | ตาม pageviews |
| Heap | 10k sessions | custom | ตาม session |

**ตำแหน่งราคาที่เราควรยืน** (ถูกกว่าเจ้าตลาด 40-60% ใน tier เริ่มต้น เพราะ cost structure เราเบากว่า - ไม่มี MTU tracking, เน้น event volume):

### 3.1 ตารางราคา uba-ai Cloud (proposed)

| Tier | ราคา | Quota | กลุ่มเป้าหมาย |
| --- | --- | --- | --- |
| Free | $0 | 100k events/เดือน, 1 project, dashboard 7 วันย้อนหลัง | indie, ลองใช้ |
| Starter | $9/เดือน | 1M events, 3 projects, retention 12 เดือน, anomaly alerts | startup เล็ก |
| Growth | $29/เดือน | 5M events, 10 projects, AI reports 50 ฉบับ/เดือน, team 5 seats | ทีม growth จริงจัง |
| Scale | $99/เดือน | 25M events, ไม่จำกัด project, AI reports 500 ฉบับ, Slack/webhook alerts, SLA email | บริษัทกลาง |
| Enterprise | custom | on-prem/self-hosted, PDPA package, SLA + support contract | regulated industry |

กฎ quota: คิดตาม event อย่างเดียว ไม่คิดตามจำนวน user - เป็นจุดขายที่ต่างจาก Amplitude/Heap ชัดเจน

### 3.2 ตารางราคา Pro license (self-hosted package)

| Tier | ราคา | สิทธิ์ |
| --- | --- | --- |
| Pro Solo | $19/เดือน หรือ $190/ปี | developer 1 คน, ฟีเจอร์ Pro ทั้งหมด, 1-3 โปรเจกต์ production |
| Pro Team | $49/เดือน | 5 seats, ไม่จำกัดโปรเจกต์, scheduled reports |
| Agency | $149/เดือน | white-label, ไม่จำกัด end-client, export แบรนด์ลูกค้า |
| Enterprise on-prem | เริ่มต้น $2,000/ปี | รวม support SLA, indemnification, on-prem LLM setup |

### 3.3 AI Reports credit pack

| Pack | ราคา | สิทธิ์ |
| --- | --- | --- |
| Sampler | ฟรี | 5 รายงาน/เดือน (ใช้ shared quota ของเรา) |
| Analyst | $12/เดือน | 100 รายงาน + weekly executive summary |
| Insight | $39/เดือน | 500 รายงาน + prompt pack เฉพาะอุตสาหกรรม + ask-your-data |

Margin: รายงานละ ~2-4k tokens ด้วยโมเดลเล็ก ต้นทุนจริงต่อรายงานต่ำกว่า $0.01 - ราคาขายจึง margin สูงมากที่ volume

---

## 4. กลยุทธ์ที่แนะนำ (recommended sequencing)

**เฟส 1 (ตอนนี้, 0 บาท): ขยายฐานผู้ใช้ฟรี**
- Publish v0.2.x ต่อเนื่อง + ทำ browser SDK เล็กๆ (wrapper ที่ผูก IntersectionObserver ให้แล้ว) เพราะ user จริงส่วนใหญ่อยู่บนเว็บ
- เขียน content เปรียบเทียบ "self-hosted analytics สำหรับคนติด PDPA"
- เป้า: npm download + GitHub star ให้ถึงจุดที่คนรู้จักชื่อ

**เฟส 2 (~1-2 เดือน): เปิด Pro license ก่อน**
- ต้นทุนต่ำสุดในทุกรายการ (โค้ดล้วน ไม่มี infra) - เลือก 2-3 ฟีเจอร์ที่คนขอมากที่สุดจาก GitHub issues มาทำเป็น Pro
- เริ่มเก็บรายได้แรกและ validate ว่ามีคนยอมจ่ายจริง

**เฟส 3 (~3-6 เดือน): เปิด uba-ai Cloud**
- เมื่อมีฐานผู้ใช้และ browser SDK แล้ว ค่อยรับภาระ infra
- ใช้ stack ที่ทีมถนัด (Cloudflare Workers + R2/D1) ตามสถาปัตยกรรม Alenout - collector เป็น Worker, dashboard เป็น frontend แยก
- Free tier 100k events คือ marketing engine ของ tier ที่จ่ายเงิน

**เฟส 4: Enterprise + Agency**
- เข้าหาโดยตรงเมื่อมี case study จากเฟส 2-3 - เป็นรายได้ก้อนใหญ่ต่อ contract

### ความเสี่ยงหลักและทางแก้

| ความเสี่ยง | ทางแก้ |
| --- | --- |
| PostHog ก็ open source + ฟรี - คู่แข่งตรงที่สุด | ชูจุด local-first/zero-dependency/PDPA ที่ PostHog ต้องยก infra ใหญ่กว่ามาก และราคาที่ถูกกว่า |
| คนใช้ฟรีแล้วไม่ยอมจ่าย | open-core ต้องตัดเส้นให้ชัด: core ฟรีจริงไม่กั๊ก, Pro ขาย automation + collaboration ไม่ใช่ขายฟีเจอร์พื้นฐาน |
| Cloud เรา infra ล่มเสียชื่อ | เริ่ม tier เล็ก, status page, และให้ทางหนีคือ self-host เสมอ (ข้อมูล export กลับ JSONL/SQLite ได้ - เป็นจุดขายด้วยซ้ำ) |
| npm ชื่อชน/clone | publish สม่ำเสมอ + สร้างแบรนด์ผ่าน content, จด trademark ชื่อถ้าไปถึงเฟส 3 |

### ตัวเลขเป้าหมายปีแรก (conservative)

- Pro license 30 ราย x เฉลี่ย $25/เดือน = ~$9,000/ปี
- Cloud Starter/Growth รวม 100 ราย x เฉลี่ย $20/เดือน = ~$24,000/ปี
- AI pack + Enterprise/Agency deals 3-5 ราย = ~$10,000-15,000/ปี
- **รวมเป้าหมายปีแรก: ~$40,000-50,000 ARR** โดยต้นทุนหลักคือเวลาพัฒนา + infra หลักสิบเหรียญต่อเดือนในเฟสแรกๆ

---

## 5. สรุปคำตอบคำถาม "เราจะขายอะไรได้บ้าง"

1. **ขายความสะดวก** (Cloud SaaS) - รายได้หลักที่ scale ได้ คิดตาม event volume ราคาใต้คู่แข่ง 40-60%
2. **ขายฟีเจอร์ขั้นสูง** (Pro license บน package เดิม) - margin เกือบ 100% เริ่มได้เร็วที่สุด
3. **ขายความฉลาด** (AI Reports managed) - margin ต่อหน่วยสูงมาก
4. **ขายความมั่นใจ** (Enterprise on-prem + PDPA package + SLA) - ก้อนใหญ่ต่อ contract
5. **ขายสิทธิ์ไปขายต่อ** (Agency white-label) - ราคาพรีเมียม
6. **ขายเวลาและความรู้** (services/consulting/training) - ไม่ scale แต่ปั้น case study

สิ่งที่ห้ามขาย: ตัว core package - ต้องคง MIT และฟรีตลอด เพราะมันคือช่องทาง acquisition ของทุกอย่างที่เหลือ (open-core ทำงานได้เมื่อของฟรีดีจริงจนคนอยากได้ของที่ยากขึ้น)
