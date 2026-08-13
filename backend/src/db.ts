import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // eslint-disable-next-line no-console
  console.warn("[db] DATABASE_URL is not set — the backend will fail on first query.");
}

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[db] Unexpected error on idle client", err);
});

export async function waitForDb(retries = 20, delayMs = 1500): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query("SELECT 1");
      // eslint-disable-next-line no-console
      console.log("[db] Connected to Postgres");
      return;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`[db] Waiting for Postgres (attempt ${attempt}/${retries})...`);
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  throw new Error("[db] Could not connect to Postgres after multiple retries");
}
