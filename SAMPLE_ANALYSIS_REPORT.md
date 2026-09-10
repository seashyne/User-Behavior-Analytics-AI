# ตัวอย่างรายงานวิเคราะห์จาก uba-ai

สร้างเมื่อ: 2026-09-10
ข้อมูล: demo dataset 60 users / 14 วัน (`uba demo --users 60 --days 14`)
คำสั่งที่ใช้: `uba analyze --funnel signup,checkout_start,purchase` และ `uba report`

หมายเหตุ: นี่คือผลลัพธ์จากข้อมูลสังเคราะห์ที่ตัว demo generator ฝังรูปแบบไว้ล่วงหน้า (ผู้ใช้ 3 กลุ่มพฤติกรรม และวันที่มี traffic spike 1 วัน) เพื่อแสดงความสามารถของระบบครบทุกชั้น

## รายงานแบบ Narrative (`uba report`)

```
USER BEHAVIOR ANALYTICS REPORT
==============================

OVERVIEW
- 2558 events from 53 users across 345 sessions
- Avg session: 5.7m with 7.4 events
- Data range: 2026-08-28 to 2026-09-11
- Top events: page_view (1706), button_click (589), checkout_start (106), purchase (73), logout (34)

FUNNEL
- signup: 11 users (step conversion -)
- checkout_start: 10 users (step conversion 90.9%)
- purchase: 9 users (step conversion 90.0%)
- Overall conversion: 81.8%

RETENTION
- day-1: 50.9%, day-2: 45.3%, day-3: 34.0%, day-4: 34.0%, day-5: 30.2%, day-6: 22.6%, day-7: 30.2%

SEGMENTS
- Casual / At-Risk Users: 26 users (avg 14 events, 2.9 sessions)
- Regular Users: 18 users (avg 44 events, 6.8 sessions)
- Power Users: 9 users (avg 158 events, 16.4 sessions)

KEY INSIGHTS
- [WARNING] Spike in daily_events on 2026-09-08: Value 400 vs mean 170.5 (z-score 2.11). 1 anomalous day-metric(s) detected in total.
- [INFO] High engagement depth: Sessions average 7.4 events, indicating strong interaction depth (avg duration 5.7m).
- [INFO] Healthy funnel: Overall conversion through signup -> checkout_start -> purchase is 81.8%.
- [INFO] Day-1 retention: 50.9% of users come back the next day, and 30.2% return after 7 days.
- [INFO] Power user base identified: 9 power users average 158 events across 9.6 active days. Study their behavior paths to replicate what works.
```

## รายงานแบบละเอียด (`uba analyze`)

```
OVERVIEW
  Events:   2558
  Users:    53
  Sessions: 345
  Avg session: 5.7 min, 7.4 events/session
  Top events: page_view (1706), button_click (589), checkout_start (106), purchase (73), logout (34)

FUNNEL
  signup: 11 users
  checkout_start: 10 users (90.9% from prev)
  purchase: 9 users (90.0% from prev)
  Overall conversion: 81.8%
  Biggest drop-off at: purchase

RETENTION (day-N return rate)
  d1: 51%  d2: 45%  d3: 34%  d4: 34%  d5: 30%  d6: 23%  d7: 30%

ANOMALIES
  2026-09-08  daily_events spike: 400 vs mean 170.5 (z=2.11)

SEGMENTS
  Casual / At-Risk Users: 26 users (avg 14 events, 2.9 sessions, 2.4 active days)
  Regular Users: 18 users (avg 44 events, 6.8 sessions, 4.8 active days)
  Power Users: 9 users (avg 158 events, 16.4 sessions, 9.6 active days)

INSIGHTS
  [WARNING] Spike in daily_events on 2026-09-08
      Value 400 vs mean 170.5 (z-score 2.11). 1 anomalous day-metric(s) detected in total.
  [INFO] High engagement depth
      Sessions average 7.4 events, indicating strong interaction depth (avg duration 5.7m).
  [INFO] Healthy funnel
      Overall conversion through signup -> checkout_start -> purchase is 81.8%.
  [INFO] Day-1 retention
      50.9% of users come back the next day, and 30.2% return after 7 days.
  [INFO] Power user base identified
      9 power users average 158 events across 9.6 active days. Study their behavior paths to replicate what works.
```

## สรุปการตีความ

- ระบบตรวจพบ spike ที่ฝังไว้ในวันที่ 10 ของ dataset (2026-09-08) ได้ถูกต้อง: ปริมาณ event 400 ครั้ง สูงกว่าค่าเฉลี่ย 170.5 ที่ z-score 2.11 จึงถูก flag เป็น WARNING
- Segmentation แยกผู้ใช้ 3 กลุ่มได้ตรงกับ archetype ที่ generator สร้างไว้ (power ~15%, regular ~35%, casual ~50%)
- Funnel และ retention คำนวณตามลำดับเวลาจริง - ผู้ใช้ที่ยิง event ไม่เรียงลำดับ step จะไม่นับว่าผ่าน step ถัดไป
- ถ้าตั้งค่า `UBA_AI_API_KEY` คำสั่ง `uba report --ai` จะส่งข้อมูลชุดเดียวกันนี้ให้ LLM เขียนเป็น executive report พร้อมข้อเสนอแนะเชิงธุรกิจแทน template ด้านบน
