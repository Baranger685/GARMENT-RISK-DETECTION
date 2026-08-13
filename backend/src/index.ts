import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { waitForDb } from "./db";
import { initSocket } from "./socket";
import { productionRouter } from "./routes/production";
import { workersRouter } from "./routes/workers";
import { alertsRouter } from "./routes/alerts";
import { authRouter } from "./routes/auth";
import { lineTargetsRouter } from "./routes/lineTargets";

const PORT = Number(process.env.PORT || 4000);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

async function main() {
  await waitForDb();

  const app = express();
  app.use(cors({ origin: FRONTEND_URL }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "garment-backend", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/line-targets", lineTargetsRouter);
  app.use("/api/production", productionRouter);
  app.use("/api/workers", workersRouter);
  app.use("/api/alerts", alertsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error("[unhandled]", err);
    res.status(500).json({ error: "Internal server error" });
  });

  const httpServer = http.createServer(app);
  initSocket(httpServer, FRONTEND_URL);

  httpServer.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] GarmentRisk backend listening on port ${PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});
