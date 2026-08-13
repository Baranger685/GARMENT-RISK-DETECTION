-- ============================================================
-- GarmentRisk Database Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS workers (
    id                   SERIAL PRIMARY KEY,
    name                 VARCHAR(120)      NOT NULL,
    line                 VARCHAR(20)       NOT NULL,          -- e.g. 'Line A'
    smv                  NUMERIC(6,2)      NOT NULL,          -- Standard Minute Value
    daily_target         INTEGER           NOT NULL,          -- expected output/day
    skill_level          VARCHAR(20)       NOT NULL DEFAULT 'standard', -- junior/standard/senior/expert
    low_efficiency_count INTEGER           NOT NULL DEFAULT 0, -- how many of the first 3 entries were < 50% efficiency
    flagged              BOOLEAN           NOT NULL DEFAULT FALSE,
    flagged_at           TIMESTAMPTZ,
    pin_hash             VARCHAR(200),                        -- bcrypt hash of the employee's login PIN
    next_entry_allowed_at TIMESTAMPTZ,                         -- server-enforced 1-hour gap between submissions
    created_at           TIMESTAMPTZ       NOT NULL DEFAULT now()
);

-- ============================================================
-- Supervisors / line admins — separate login, PIN-based like
-- employees but a distinct table/role so a leaked employee PIN
-- can never grant acknowledge/clear-flag rights.
-- ============================================================
CREATE TABLE IF NOT EXISTS supervisors (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    pin_hash    VARCHAR(200) NOT NULL,
    role        VARCHAR(20)  NOT NULL DEFAULT 'supervisor',  -- 'supervisor' | 'admin'
    line        VARCHAR(20),                                  -- NULL = all lines (admin); set = line-scoped supervisor
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ============================================================
-- Per-line hourly/daily targets, set manually by a supervisor.
-- All employees on a line share the same target.
-- ============================================================
CREATE TABLE IF NOT EXISTS line_targets (
    line             VARCHAR(20) PRIMARY KEY,
    target_per_hour  NUMERIC(8,2) NOT NULL,
    target_per_day   NUMERIC(8,2) NOT NULL,
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_logs (
    id                SERIAL PRIMARY KEY,
    worker_id         INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    line              VARCHAR(20) NOT NULL,
    entry_number      INTEGER NOT NULL DEFAULT 1,  -- this worker's all-time entry sequence number (1, 2, 3, ...)
    actual_output     INTEGER NOT NULL,
    smv               NUMERIC(6,2) NOT NULL,
    available_minutes INTEGER NOT NULL DEFAULT 480,
    efficiency        NUMERIC(6,2) NOT NULL,      -- computed %, Sri Lankan formula
    target_efficiency NUMERIC(6,2) NOT NULL DEFAULT 100,
    target_per_hour   NUMERIC(8,2),                -- line's hourly target at time of submission
    target_per_day    NUMERIC(8,2),                -- line's daily target at time of submission
    variance          NUMERIC(6,2) NOT NULL,       -- % deviation from target
    risk_level        VARCHAR(10) NOT NULL,        -- low / medium / high
    efficiency_category VARCHAR(10) NOT NULL DEFAULT 'medium', -- high / medium / risk
    is_low_efficiency BOOLEAN NOT NULL DEFAULT FALSE,
    is_outlier        BOOLEAN NOT NULL DEFAULT FALSE,
    downtime_minutes  INTEGER NOT NULL DEFAULT 0,
    downtime_reason   VARCHAR(120),
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
    id            SERIAL PRIMARY KEY,
    worker_id     INTEGER REFERENCES workers(id) ON DELETE CASCADE,
    production_id INTEGER REFERENCES production_logs(id) ON DELETE SET NULL,
    type          VARCHAR(30) NOT NULL,      -- risk / flagged / downtime
    severity      VARCHAR(10) NOT NULL,      -- low / medium / high
    message       TEXT NOT NULL,
    acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,  -- cleared by a supervisor
    employee_seen BOOLEAN NOT NULL DEFAULT FALSE,  -- shown to the employee on their own dashboard
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prodlogs_worker ON production_logs(worker_id);
CREATE INDEX IF NOT EXISTS idx_prodlogs_created ON production_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_worker ON alerts(worker_id);
CREATE INDEX IF NOT EXISTS idx_alerts_ack ON alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_line_targets_line ON line_targets(line);

-- ============================================================
-- Migration block — safe to re-run against a database created by an
-- older version of this schema (adds the new auth/target/flagging
-- columns without touching existing rows or data).
-- ============================================================
ALTER TABLE workers  ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(200);
ALTER TABLE workers  ADD COLUMN IF NOT EXISTS next_entry_allowed_at TIMESTAMPTZ;
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS entry_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS target_per_hour NUMERIC(8,2);
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS target_per_day NUMERIC(8,2);
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS efficiency_category VARCHAR(10) NOT NULL DEFAULT 'medium';
ALTER TABLE alerts   ADD COLUMN IF NOT EXISTS employee_seen BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- Seed data — 8 demo workers (from README)
--
-- pin_hash values below are real bcrypt hashes (cost 10) of each
-- worker's demo PIN: Kasun=1001, Nadeesha=1002, Chamara=1003,
-- Dilrukshi=1004, Ruwan=1005, Malika=1006, Pradeep=1007, Samanthi=1008.
-- Regenerate with: node -e "console.log(require('bcryptjs').hashSync('1001',10))"
-- ============================================================
INSERT INTO workers (name, line, smv, daily_target, skill_level, pin_hash) VALUES
    ('Kasun Perera',           'Line A', 0.80, 140, 'standard', '$2a$10$VftbspfgjX0XE6Dqyy7Ebu4JRYmfgqBgPyFeIIcgj.jM1kXtZtRAS'),
    ('Nadeesha Silva',         'Line B', 1.00, 160, 'senior',   '$2a$10$AxbtKy2dOA9ro4y5EAqdouby/VNnutTZM.dcbgFentU8xyNNdvqDq'),
    ('Chamara Fernando',       'Line A', 0.75, 130, 'standard', '$2a$10$.z4VcF8g4FM8NDzagoHy5.DLp8XP0PxXxVPlQuknz/cyvqzgqjYaK'),
    ('Dilrukshi Jayawardena',  'Line C', 0.90, 150, 'expert',   '$2a$10$pBsdxclMjvJKwv2X2yI/ReBIbdx.Bx0gn5T4qMFaSBYzgCzKkzgNK'),
    ('Ruwan Bandara',          'Line B', 1.10, 110, 'junior',   '$2a$10$fIfLa34cuy1TPrzJN8MAv.qutyFOCL.vLMPDxhkI94ReF5ons1U5C'),
    ('Malika Wickramasinghe',  'Line C', 0.85, 145, 'senior',   '$2a$10$7nFl6XqL6TeZ8sKQuExW6OZjimUQ7Ct4ZPICEr/NYSqdpyU2SSDE6'),
    ('Pradeep Kumara',         'Line A', 0.80, 135, 'standard', '$2a$10$wyZI93I07f35Eg7pPpN7DOifvMT8dl6W7LOlGUBKBnLC7GYBK7yKW'),
    ('Samanthi Rathnayake',    'Line D', 0.95, 125, 'standard', '$2a$10$km86VRwWWcDmLlW0kpJ3Q.4G362mdhwL7J.rA.05HrbaXFgXR7yPu')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Seed data — supervisors
-- Demo PINs: Line A Supervisor=2001 (Line A only), Floor Admin=9000 (all lines, role=admin)
-- ============================================================
INSERT INTO supervisors (name, pin_hash, role, line) VALUES
    ('Line A Supervisor', '$2a$10$Of68EFXRE3LTRdRELcvkV.aDIsbt6DQIR2KbU292xerBZ0pvg68A.', 'supervisor', 'Line A'),
    ('Floor Admin',       '$2a$10$4oeRVVPP1vM50/KXO.OgYOUHfR2NBJ2aUZRvwGhoNvbXZ/..wDlgq', 'admin', NULL)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Seed data — per-line targets (manually set by a supervisor)
-- ============================================================
INSERT INTO line_targets (line, target_per_hour, target_per_day) VALUES
    ('Line A', 18, 140),
    ('Line B', 20, 160),
    ('Line C', 19, 150),
    ('Line D', 16, 125)
ON CONFLICT (line) DO NOTHING;
