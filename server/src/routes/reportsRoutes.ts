import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { buildReportsKpis } from "../reportsService.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(raw: string): { ok: true; value: string } | { ok: false } {
  if (!ISO_DATE.test(raw)) return { ok: false };
  const [y, m, d] = raw.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return { ok: false };
  return { ok: true, value: raw };
}

function daysInclusive(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.floor((t2 - t1) / 86400000) + 1;
}

export function reportsRoutes(): Router {
  const r = createRouter();

  r.get(
    "/kpis",
    requireAuth,
    requireAnyPermission("finance.reports", "lodging.reservations"),
    (req: Request, res: Response) => {
      const fromRaw = req.query.from;
      const toRaw = req.query.to;
      const from = typeof fromRaw === "string" ? parseIsoDate(fromRaw) : { ok: false as const };
      const to = typeof toRaw === "string" ? parseIsoDate(toRaw) : { ok: false as const };
      if (!from.ok || !to.ok) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      if (from.value > to.value) {
        res.status(400).json({ code: "invalid_range" });
        return;
      }
      const span = daysInclusive(from.value, to.value);
      if (span > 366) {
        res.status(400).json({ code: "range_too_long" });
        return;
      }
      res.json(buildReportsKpis(from.value, to.value));
    },
  );

  return r;
}
