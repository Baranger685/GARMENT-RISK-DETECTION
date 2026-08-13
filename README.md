# GarmentRisk — Real-Time Production Risk Detection & Efficiency Monitoring

Full-stack production monitoring platform for the **Sri Lankan garment industry**.
Combines ML predictions, real-time Socket.IO updates, and variance analysis.

---

## Quick Start (3 options)

### Option A — Docker Compose (recommended, all services in one command)

```bash
git clone / unzip project
cd garment-risk-system
docker compose up --build
```

Then open **http://localhost:3000**

---

### Option B — Manual (local development)

**Requirements:** Node.js 18+, Python 3.10+, PostgreSQL 14+

#### 1. Database
```bash
createdb garment_risk
psql garment_risk < database/schema.sql
```

#### 2. ML Service
```bash
cd ml-service
pip install -r requirements.txt
python app.py
# → http://localhost:5001
```

#### 3. Backend
```bash
cd backend
npm install

cp ../.env.example .env
# edit .env if your local Postgres user/password differ from the default

npm run dev
# → http://localhost:4000
```

#### 4. Frontend
```bash
cd frontend
npm install
echo "NEXT_PUBLIC_BACKEND_URL=http://localhost:4000" > .env.local
npm run dev
# → http://localhost:3000
```

---

### Option C — Frontend Only (demo mode, no backend needed)

```bash
cd frontend
npm install
npm run dev
```

Every page automatically falls back to embedded demo data (8 seeded workers,
sample logs, sample alerts) whenever the backend can't be reached — including
one pre-flagged demo worker, so you can see the flagging UI immediately.
The Submit Log page computes efficiency locally in this mode.

---

## Architecture

```
Browser (Next.js 14)
  │  HTTP REST + WebSocket
  ▼
Node.js / Express (port 4000)
  │  Socket.IO → pushes live updates to browser
  │  REST → Python ML service
  ▼
Python / Flask (port 5001)   PostgreSQL (port 5432)
  Predictions + risk scores   Workers, logs, alerts, predictions
```

---

## Sri Lankan Efficiency Formula

```
Efficiency (%) = ((Actual Output × SMV) / Total Available Minutes) × 100
```

Example — Kasun: `((120 × 0.8) / 480) × 100 = 20%`

The ML service (`ml-service/app.py`) is the single source of truth for this
formula. The backend also carries a local fallback copy so a submission never
fails outright if the ML service is briefly unreachable — it just logs a
warning and calculates the same formula in-process.

---

## Variance Classification

| Variance %  | Risk Level  |
|-------------|-------------|
| 0 – 10%     | Low Risk    |
| 10 – 25%    | Medium Risk |
| > 25%       | High Risk   |

`variance = ((efficiency − target_efficiency) / target_efficiency) × 100`,
classified on its absolute value (works whether the worker is over or under
target).

---

## Low-Efficiency Flagging (new)

Every submitted production log is checked against a **low-efficiency rule**:

> A submission counts as "low efficiency" if efficiency is **below 50%**
> (absolute floor), **or** more than **15% below the worker's own rolling
> historical average** (last 10 submissions) — whichever applies.

Each low-efficiency submission adds a **strike** to that worker's all-time
counter. On the **3rd strike**, the worker is automatically **flagged**:

- The flag is **all-time** — it does **not** reset on its own. A supervisor
  must explicitly clear it from the **Workers** page (`Clear Flag` button /
  `PATCH /api/workers/:id/clear-flag`), which also resets the strike counter
  to 0.
- Flagged workers appear in a dedicated **"Flagged Workers — by Production
  Line"** panel at the top of the **Dashboard**, grouped by line so
  supervisors can immediately see which line each flagged worker is on.
- A `flagged`-type, high-severity alert is raised and pushed live via
  Socket.IO (`alert:new`) the moment a worker crosses the 3-strike threshold.

## Submit-Log Countdown (new)

The **Submit Log** page runs a **60-second countdown** ("Analyzing production
data…") after a log is submitted, before revealing the ML result. The real
API call typically returns in well under a second — the countdown is a
deliberate pacing/suspense device, not a processing delay. The result screen
is only shown once the countdown reaches zero **and** the analysis response
has been received. If a submission's 3rd strike flags the worker, that's
called out prominently on the result screen, along with the worker's line.

---

## Pages

| URL          | Description                                                      |
|--------------|-------------------------------------------------------------------|
| `/dashboard` | Live KPIs, hourly chart, flagged-workers-by-line panel, alert feed|
| `/workers`   | Worker cards with strike counts, flag badges, clear-flag action  |
| `/analytics` | Risk breakdown, downtime by reason, variance reference table     |
| `/alerts`    | Full alert management with acknowledge                           |
| `/submit`    | Production log form → 60s countdown → ML analysis result         |

---

## API Endpoints

```
GET   /health                              Service health check
POST  /api/production                      Submit production log (runs ML, strikes, flags, alerts)
GET   /api/production                      List logs (filter by worker_id / line)
GET   /api/production/dashboard-summary    Dashboard aggregation (KPIs, hourly trend, flagged-by-line)
GET   /api/workers                         All workers + today's stats
GET   /api/workers/:id                     Single worker detail + recent logs/alerts
GET   /api/workers/:id/efficiency-trend    7-day trend
POST  /api/workers                         Create worker
PATCH /api/workers/:id/clear-flag          Clear a worker's flag and reset strike count
GET   /api/alerts                          List alerts (filter by acknowledged)
GET   /api/alerts/stats                    Alert counts
PATCH /api/alerts/:id/acknowledge          Acknowledge alert
POST  /api/alerts/downtime                 Log downtime event
GET   /api/alerts/downtime/stats           Downtime breakdown
```

## ML Service Endpoints

```
GET  /health                Health check
POST /api/predict           Single prediction: efficiency, variance, risk_level, is_low_efficiency, is_outlier
POST /api/predict/batch     Batch predictions
POST /api/outlier-check     Standalone outlier validation (z-score vs history)
```

---

## Socket.IO Events

| Event                | Direction        | Description                          |
|-----------------------|------------------|---------------------------------------|
| `dashboard:update`    | Server → Browser | New production log submitted          |
| `alert:new`           | Server → Browser | New risk / flagged / downtime alert   |
| `worker:update`       | Server → Browser | Worker strike count / flag changed    |
| `alert:acknowledged`  | Server → Browser | An alert was acknowledged             |
| `join:line`           | Browser → Server | Subscribe to a production line's room |
| `acknowledge:alert`   | Browser → Server | Mark alert as read                    |

---

## Demo Workers (pre-seeded)

| Name                    | Line   | SMV  | Target | Skill    |
|-------------------------|--------|------|--------|----------|
| Kasun Perera            | Line A | 0.80 | 140    | standard |
| Nadeesha Silva          | Line B | 1.00 | 160    | senior   |
| Chamara Fernando        | Line A | 0.75 | 130    | standard |
| Dilrukshi Jayawardena   | Line C | 0.90 | 150    | expert   |
| Ruwan Bandara           | Line B | 1.10 | 110    | junior   |
| Malika Wickramasinghe   | Line C | 0.85 | 145    | senior   |
| Pradeep Kumara          | Line A | 0.80 | 135    | standard |
| Samanthi Rathnayake     | Line D | 0.95 | 125    | standard |

---

## Tech Stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Frontend  | Next.js 14, TypeScript, Tailwind CSS, Recharts, Socket.IO client |
| Backend   | Node.js, Express, TypeScript, Socket.IO |
| ML        | Python 3, Flask, flask-cors             |
| Database  | PostgreSQL 16                           |
| Deploy    | Docker + Docker Compose                 |

---

## Notes on Design Decisions

These were pinned down explicitly for this build (see the "Low-Efficiency
Flagging" and "Submit-Log Countdown" sections above for the full rules):

1. **Low efficiency** = below 50% absolute, OR ≥15% below the worker's own
   rolling average — combining an absolute floor with a personal-baseline
   check so both chronically low performers and workers with a sudden drop
   get caught.
2. **Strike count is all-time** and only clears via an explicit supervisor
   action (`Clear Flag`), not automatically over time.
3. **The countdown** is a 60-second UX pacing device before the ML result is
   revealed, not a rate-limit on submissions.
