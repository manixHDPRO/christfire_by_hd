import { randomUUID } from "node:crypto";
import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import {
  assignedPointOfSaleIdsForUser,
  roleSeesAllCashRegisterData,
  userMayAccessPointOfSale,
} from "../cashRegisterScope.js";
import { localBusinessDateNow, requireCashDayOpenForRole } from "../cashDayOpen.js";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";

const methodEnum = z.enum(["Espèces", "Carte", "Virement", "Autre"]);

const createCounterSaleSchema = z.object({
  amountCdf: z.number().int().min(1).max(999_999_999),
  method: methodEnum.optional().default("Espèces"),
  label: z.string().max(120).optional().default(""),
  note: z.string().max(500).optional().default(""),
  clientId: z.string().max(80).optional(),
  pointOfSaleId: z.string().max(80).optional(),
});

type SaleRow = {
  id: string;
  amount_cdf: number;
  method: string;
  label: string;
  note: string;
  client_id: string | null;
  created_at: string;
  created_by_user_id: string | null;
  client_name: string | null;
  created_by_name: string | null;
  point_of_sale_id: string | null;
  point_of_sale_label: string | null;
};

function rowToPublic(row: SaleRow) {
  return {
    id: row.id,
    amountCdf: row.amount_cdf,
    method: row.method,
    label: row.label,
    note: row.note,
    clientId: row.client_id,
    clientName: row.client_name,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    pointOfSaleId: row.point_of_sale_id,
    pointOfSaleLabel: row.point_of_sale_label,
  };
}

function defaultPointOfSaleId(): string {
  const row = db
    .prepare(`SELECT id FROM stock_points_of_sale WHERE active = 1 ORDER BY is_main DESC, sort_order ASC LIMIT 1`)
    .get() as { id: string } | undefined;
  return row?.id ?? "pos-t1";
}

function defaultPointOfSaleIdForUser(role: string, userId: string): string | null {
  if (roleSeesAllCashRegisterData(role)) {
    return defaultPointOfSaleId();
  }
  const ids = assignedPointOfSaleIdsForUser(userId);
  return ids[0] ?? null;
}

export function counterSaleRoutes(): Router {
  const r = createRouter();

  r.get(
    "/points-of-sale",
    requireAuth,
    requireAnyPermission("finance.counter", "finance.treasury"),
    (req: AuthedRequest, res: Response) => {
      const role = req.auth?.role ?? "";
      const userId = req.auth?.sub ?? "";
      const globalView = roleSeesAllCashRegisterData(role);
      let sql = `SELECT id, code, label, sort_order AS sortOrder, is_main AS isMain
           FROM stock_points_of_sale WHERE active = 1`;
      const qparams: string[] = [];
      if (!globalView) {
        const ids = assignedPointOfSaleIdsForUser(userId);
        if (ids.length === 0) {
          res.json({ pointsOfSale: [] });
          return;
        }
        sql += ` AND id IN (${ids.map(() => "?").join(",")})`;
        qparams.push(...ids);
      }
      sql += ` ORDER BY sort_order ASC, code ASC`;
      const rows = db.prepare(sql).all(...qparams) as {
        id: string;
        code: string;
        label: string;
        sortOrder: number;
        isMain: number;
      }[];
      res.json({
        pointsOfSale: rows.map((x) => ({
          id: x.id,
          code: x.code,
          label: x.label,
          sortOrder: x.sortOrder,
          isMain: x.isMain === 1,
        })),
      });
    },
  );

  r.get("/", requireAuth, requireAnyPermission("finance.counter"), (req: AuthedRequest, res: Response) => {
    const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : null;
    const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : null;

    const conditions: string[] = ["1=1"];
    const params: string[] = [];
    if (from) {
      conditions.push("date(s.created_at) >= date(?)");
      params.push(from);
    }
    if (to) {
      conditions.push("date(s.created_at) <= date(?)");
      params.push(to);
    }

    const role = req.auth?.role ?? "";
    const userId = req.auth?.sub ?? "";
    if (!roleSeesAllCashRegisterData(role)) {
      const posIds = assignedPointOfSaleIdsForUser(userId);
      if (posIds.length === 0) {
        res.json({ sales: [] });
        return;
      }
      const ph = posIds.map(() => "?").join(",");
      conditions.push(`s.point_of_sale_id IN (${ph})`);
      params.push(...posIds);
      conditions.push("s.created_by_user_id = ?");
      params.push(userId);
    }

    const sql = `
      SELECT s.id, s.amount_cdf, s.method, s.label, s.note, s.client_id, s.created_at, s.created_by_user_id,
             s.point_of_sale_id,
             c.name AS client_name,
             u.name AS created_by_name,
             p.label AS point_of_sale_label
      FROM counter_sales s
      LEFT JOIN clients c ON c.id = s.client_id
      LEFT JOIN users u ON u.id = s.created_by_user_id
      LEFT JOIN stock_points_of_sale p ON p.id = s.point_of_sale_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 500
    `;

    const rows = db.prepare(sql).all(...params) as SaleRow[];
    res.json({ sales: rows.map(rowToPublic) });
  });

  r.post("/", requireAuth, requireAnyPermission("finance.counter"), (req: AuthedRequest, res: Response) => {
    const parsed = createCounterSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const role = req.auth?.role ?? "";
    const uid = req.auth?.sub ?? "";
    const { amountCdf, method, label, note, clientId: rawClientId, pointOfSaleId: rawPosId } = parsed.data;
    const clientId = rawClientId?.trim() || null;
    let pointOfSaleId = rawPosId?.trim() || defaultPointOfSaleIdForUser(role, uid) || "";
    const posOk = db.prepare("SELECT 1 FROM stock_points_of_sale WHERE id = ? AND active = 1").get(pointOfSaleId);
    if (!posOk) {
      const fb = defaultPointOfSaleIdForUser(role, uid);
      pointOfSaleId = fb ?? "";
    }
    if (!pointOfSaleId) {
      res.status(403).json({ code: "no_point_of_sale_assignment" });
      return;
    }

    if (!userMayAccessPointOfSale(role, uid, pointOfSaleId)) {
      res.status(403).json({ code: "forbidden_point_of_sale" });
      return;
    }

    if (!requireCashDayOpenForRole(role, localBusinessDateNow(), res)) return;

    if (clientId) {
      const ok = db.prepare("SELECT 1 AS x FROM clients WHERE id = ?").get(clientId) as { x: number } | undefined;
      if (!ok) {
        res.status(400).json({ code: "unknown_client" });
        return;
      }
    }

    const id = randomUUID();
    const userId = req.auth?.sub ?? null;

    try {
      db.prepare(
        `INSERT INTO counter_sales (id, amount_cdf, method, label, note, client_id, created_by_user_id, point_of_sale_id)
         VALUES (@id, @amount_cdf, @method, @label, @note, @client_id, @created_by_user_id, @point_of_sale_id)`,
      ).run({
        id,
        amount_cdf: amountCdf,
        method,
        label: label.trim(),
        note: note.trim(),
        client_id: clientId ?? null,
        created_by_user_id: userId,
        point_of_sale_id: pointOfSaleId,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "insert_failed" });
      return;
    }

    const row = db
      .prepare(
        `SELECT s.id, s.amount_cdf, s.method, s.label, s.note, s.client_id, s.created_at, s.created_by_user_id,
                s.point_of_sale_id,
                c.name AS client_name,
                u.name AS created_by_name,
                p.label AS point_of_sale_label
         FROM counter_sales s
         LEFT JOIN clients c ON c.id = s.client_id
         LEFT JOIN users u ON u.id = s.created_by_user_id
         LEFT JOIN stock_points_of_sale p ON p.id = s.point_of_sale_id
         WHERE s.id = ?`,
      )
      .get(id) as SaleRow;
    res.status(201).json({ sale: rowToPublic(row) });
  });

  return r;
}
