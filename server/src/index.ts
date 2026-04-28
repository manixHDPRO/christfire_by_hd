import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express, { json as expressJson } from "express";
import helmet from "helmet";
import { db } from "./db.js";
import {
  migrateLegacyUserEmails,
  seedBungalowsIfEmpty,
  seedClientsIfEmpty,
  seedExchangeRateAndCategoryRatesIfEmpty,
  seedReservationsIfEmpty,
  seedUsersIfEmpty,
} from "./seed.js";
import { syncBungalowStatusForDb } from "./syncBungalowStatus.js";
import { auditRoutes } from "./routes/auditRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { bungalowRoutes } from "./routes/bungalowRoutes.js";
import { clientProfileTypeRoutes } from "./routes/clientProfileTypeRoutes.js";
import { cashBookRoutes } from "./routes/cashBookRoutes.js";
import { clientRoutes } from "./routes/clientRoutes.js";
import { counterSaleRoutes } from "./routes/counterSaleRoutes.js";
import { paymentRoutes } from "./routes/paymentRoutes.js";
import { reservationRoutes } from "./routes/reservationRoutes.js";
import { maintenanceTicketRoutes } from "./routes/maintenanceTicketRoutes.js";
import { inventoryPurchaseOrderRoutes } from "./routes/inventoryPurchaseOrderRoutes.js";
import { inventoryRoutes } from "./routes/inventoryRoutes.js";
import { operationalWorkflowRoutes } from "./routes/operationalWorkflowRoutes.js";
import { nightAuditRoutes } from "./routes/nightAuditRoutes.js";
import { reportsRoutes } from "./routes/reportsRoutes.js";
import { settingsRoutes } from "./routes/settingsRoutes.js";
import { treasuryRoutes } from "./routes/treasuryRoutes.js";
import { userRoleRoutes } from "./routes/userRoleRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";

/** Racine du dépôt (parent de server/), que le process soit lancé depuis / ou /server */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  app.use(
    cors({
      origin: corsOrigin.split(",").map((o) => o.trim()),
      credentials: true,
    }),
  );
}

const jsonDefault = expressJson({ limit: "128kb" });
const jsonMaintenanceAttachment = expressJson({ limit: "4mb" });
app.use((req, res, next) => {
  if (
    req.method === "POST" &&
    /^\/api\/maintenance-tickets\/[^/]+\/attachments\/?$/.test(req.originalUrl.split("?")[0] ?? "")
  ) {
    jsonMaintenanceAttachment(req, res, next);
    return;
  }
  jsonDefault(req, res, next);
});
app.use(cookieParser());

try {
  seedUsersIfEmpty();
  seedClientsIfEmpty();
  seedBungalowsIfEmpty();
  /** Réservations de démo : uniquement si la table est vide ET `SEED_DEMO_RESERVATIONS=1` (sinon une purge reste vide au redémarrage). */
  if (process.env.SEED_DEMO_RESERVATIONS === "1") {
    seedReservationsIfEmpty();
  }
  seedExchangeRateAndCategoryRatesIfEmpty();
  migrateLegacyUserEmails();
} catch (e) {
  console.error(e);
  process.exit(1);
}

{
  const bungalowIds = db.prepare("SELECT id FROM bungalows").all() as { id: string }[];
  for (const { id } of bungalowIds) {
    syncBungalowStatusForDb(id);
  }
}

app.get("/api/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, service: "hd-christfire-api" });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use("/api/auth", authRoutes());
app.use("/api/audit-log", auditRoutes());
app.use("/api/users", userRoutes());
app.use("/api/user-roles", userRoleRoutes());
app.use("/api/clients", clientRoutes());
app.use("/api/client-profile-types", clientProfileTypeRoutes());
app.use("/api/bungalows", bungalowRoutes());
app.use("/api/reservations", reservationRoutes());
app.use("/api/payments", paymentRoutes());
app.use("/api/counter-sales", counterSaleRoutes());
app.use("/api/treasury", treasuryRoutes());
app.use("/api/finance-cash", cashBookRoutes());
app.use("/api/settings", settingsRoutes());
app.use("/api/inventory", inventoryRoutes());
app.use("/api/inventory", inventoryPurchaseOrderRoutes());
app.use("/api/maintenance-tickets", maintenanceTicketRoutes());
app.use("/api/operational-workflow", operationalWorkflowRoutes());
app.use("/api/night-audit", nightAuditRoutes());
app.use("/api/reports", reportsRoutes());

const isProd = process.env.NODE_ENV === "production";
const distDir = path.join(repoRoot, "dist");

if (isProd && fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(PORT, () => {
  console.info(`[hd-christfire] API sur le port ${PORT} (NODE_ENV=${process.env.NODE_ENV ?? "development"})`);
  if (isProd && !fs.existsSync(distDir)) {
    console.warn("[hd-christfire] Dossier dist/ introuvable : exécutez le build front depuis la racine du projet.");
  }
});
