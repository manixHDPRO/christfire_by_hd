import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const closeBodySchema = z.object({
  businessDate: dateParam,
  notes: z.string().max(2000).optional().default(""),
  countedCashUsd: z.number().int().min(0).max(999_999_999).optional(),
  countedCashCdf: z.number().int().min(0).max(999_999_999_999).optional(),
});

function getFxCdfPerUsd(): number {
  const row = db.prepare("SELECT cdf_per_usd FROM app_exchange_rate WHERE id = 1").get() as
    | { cdf_per_usd: number }
    | undefined;
  const n = Number(row?.cdf_per_usd ?? 0);
  return n > 0 ? Math.floor(n) : 2850;
}

function todayUtcISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

type MethodTotals = Record<string, number>;

function sumByMethod(rows: { method: string; amount: number }[]): { total: number; byMethod: MethodTotals } {
  const byMethod: MethodTotals = {};
  let total = 0;
  for (const r of rows) {
    const m = r.method || "Autre";
    const a = Number(r.amount) || 0;
    total += a;
    byMethod[m] = (byMethod[m] ?? 0) + a;
  }
  return { total, byMethod };
}

function cashUsdFromByMethod(by: MethodTotals): number {
  return by["Espèces"] ?? 0;
}

function computeDayFigures(businessDate: string) {
  const fx = getFxCdfPerUsd();

  const rpRows = db
    .prepare(
      `SELECT p.id, p.reservation_id,
              p.amount AS amount_nominal,
              COALESCE(NULLIF(TRIM(p.currency), ''), 'USD') AS currency,
              COALESCE(p.amount_usd_equivalent, p.amount) AS amount_usd_eq,
              p.method, p.note, p.created_at,
              c.name AS client_name, b.code AS bungalow_code
       FROM reservation_payments p
       JOIN reservations r ON r.id = p.reservation_id
       JOIN clients c ON c.id = r.client_id
       JOIN bungalows b ON b.id = r.bungalow_id
       WHERE date(p.created_at) = date(?)`,
    )
    .all(businessDate) as {
    id: string;
    reservation_id: string;
    amount_nominal: number;
    currency: string;
    amount_usd_eq: number;
    method: string;
    note: string;
    created_at: string;
    client_name: string;
    bungalow_code: string;
  }[];

  const veRows = db
    .prepare(
      `SELECT v.id, v.client_id,
              v.amount_usd AS amount,
              COALESCE(v.amount_nominal, v.amount_usd) AS amount_nominal,
              COALESCE(NULLIF(TRIM(v.currency), ''), 'USD') AS currency,
              v.method, v.note, v.created_at, c.name AS client_name
       FROM visitor_entry_payment_ledger v
       JOIN clients c ON c.id = v.client_id
       WHERE date(v.created_at) = date(?)`,
    )
    .all(businessDate) as {
    id: string;
    client_id: string;
    amount: number;
    amount_nominal: number;
    currency: string;
    method: string;
    note: string;
    created_at: string;
    client_name: string;
  }[];

  const csRows = db
    .prepare(
      `SELECT s.id, s.amount_cdf AS amount, s.method, s.label, s.note, s.created_at,
              c.name AS client_name,
              p.label AS point_of_sale_label
       FROM counter_sales s
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN stock_points_of_sale p ON p.id = s.point_of_sale_id
       WHERE date(s.created_at) = date(?)`,
    )
    .all(businessDate) as {
    id: string;
    amount: number;
    method: string;
    label: string;
    note: string;
    created_at: string;
    client_name: string | null;
    point_of_sale_label: string | null;
  }[];

  const rp = sumByMethod(rpRows.map((r) => ({ method: r.method, amount: r.amount_usd_eq })));
  const ve = sumByMethod(veRows.map((r) => ({ method: r.method, amount: r.amount })));
  const cs = sumByMethod(csRows.map((r) => ({ method: r.method, amount: r.amount })));

  const expectedCashUsd = cashUsdFromByMethod(rp.byMethod) + cashUsdFromByMethod(ve.byMethod);
  const expectedCashCdf = cashUsdFromByMethod(cs.byMethod);

  return {
    fxCdfPerUsd: fx,
    reservationPayments: {
      count: rpRows.length,
      totalUsd: rp.total,
      byMethod: rp.byMethod,
      cashUsd: cashUsdFromByMethod(rp.byMethod),
      lines: rpRows.map((r) => ({
        id: r.id,
        reservationId: r.reservation_id,
        amountUsd: r.amount_usd_eq,
        amountNominal: r.amount_nominal,
        currency: r.currency === "CDF" ? "CDF" : "USD",
        method: r.method,
        note: r.note,
        createdAt: r.created_at,
        clientName: r.client_name,
        bungalowCode: r.bungalow_code,
      })),
    },
    visitorEntryPayments: {
      count: veRows.length,
      totalUsd: ve.total,
      byMethod: ve.byMethod,
      cashUsd: cashUsdFromByMethod(ve.byMethod),
      lines: veRows.map((r) => ({
        id: r.id,
        clientId: r.client_id,
        amountUsd: r.amount,
        amountNominal: r.amount_nominal,
        currency: r.currency === "CDF" ? "CDF" : "USD",
        method: r.method,
        note: r.note,
        createdAt: r.created_at,
        clientName: r.client_name,
      })),
    },
    counterSales: {
      count: csRows.length,
      totalCdf: cs.total,
      byMethod: cs.byMethod,
      cashCdf: cashUsdFromByMethod(cs.byMethod),
      lines: csRows.map((r) => ({
        id: r.id,
        amountCdf: r.amount,
        method: r.method,
        label: r.label,
        note: r.note,
        createdAt: r.created_at,
        clientName: r.client_name,
        pointOfSaleLabel: r.point_of_sale_label,
      })),
    },
    expectedCashUsd,
    expectedCashCdf,
  };
}

type ClosureRow = {
  business_date: string;
  closed_at: string;
  closed_by_user_id: string | null;
  notes: string;
  expected_cash_usd: number;
  expected_cash_cdf: number;
  counted_cash_usd: number | null;
  counted_cash_cdf: number | null;
  fx_cdf_per_usd_snapshot: number;
  closed_by_name: string | null;
};

function closureRowToPublic(row: ClosureRow) {
  const countedUsd = row.counted_cash_usd;
  const countedCdf = row.counted_cash_cdf;
  return {
    businessDate: row.business_date,
    closedAt: row.closed_at,
    closedByUserId: row.closed_by_user_id,
    closedByName: row.closed_by_name,
    notes: row.notes,
    expectedCashUsd: row.expected_cash_usd,
    expectedCashCdf: row.expected_cash_cdf,
    countedCashUsd: countedUsd,
    countedCashCdf: countedCdf,
    fxCdfPerUsdSnapshot: row.fx_cdf_per_usd_snapshot,
    varianceCashUsd: countedUsd == null ? null : countedUsd - row.expected_cash_usd,
    varianceCashCdf: countedCdf == null ? null : countedCdf - row.expected_cash_cdf,
  };
}

function auditDetailAmountLabel(currency: "USD" | "CDF", amountNominal: number, amountUsd: number): string {
  if (currency === "CDF") {
    return `${amountNominal} FC (${amountUsd} USD eq)`;
  }
  return `${amountUsd} USD`;
}

function buildCsv(businessDate: string, figures: ReturnType<typeof computeDayFigures>): string {
  const lines: string[] = [];
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  lines.push(["section", "champ", "valeur"].join(";"));
  lines.push(["meta", "date_activite", businessDate].join(";"));
  lines.push(["meta", "fx_cdf_par_usd", String(figures.fxCdfPerUsd)].join(";"));
  lines.push(["totaux", "encaissements_reservation_usd", String(figures.reservationPayments.totalUsd)].join(";"));
  lines.push(["totaux", "droits_entree_visiteur_usd", String(figures.visitorEntryPayments.totalUsd)].join(";"));
  lines.push(["totaux", "ventes_comptoir_cdf", String(figures.counterSales.totalCdf)].join(";"));
  lines.push(["caisse", "attendu_especes_usd", String(figures.expectedCashUsd)].join(";"));
  lines.push(["caisse", "attendu_especes_cdf", String(figures.expectedCashCdf)].join(";"));

  for (const m of Object.keys(figures.reservationPayments.byMethod).sort()) {
    lines.push(["par_methode_reservation_usd", m, String(figures.reservationPayments.byMethod[m])].join(";"));
  }
  for (const m of Object.keys(figures.visitorEntryPayments.byMethod).sort()) {
    lines.push(["par_methode_visiteur_usd", m, String(figures.visitorEntryPayments.byMethod[m])].join(";"));
  }
  for (const m of Object.keys(figures.counterSales.byMethod).sort()) {
    lines.push(["par_methode_comptoir_cdf", m, String(figures.counterSales.byMethod[m])].join(";"));
  }

  lines.push(["detail", "type", "id", "montant", "methode", "horodatage", "libelle"].join(";"));
  for (const r of figures.reservationPayments.lines) {
    lines.push(
      [
        "ligne",
        "reservation",
        r.id,
        auditDetailAmountLabel(r.currency === "CDF" ? "CDF" : "USD", r.amountNominal, r.amountUsd),
        r.method,
        r.createdAt,
        esc(`${r.clientName} · ${r.bungalowCode}`),
      ].join(";"),
    );
  }
  for (const r of figures.visitorEntryPayments.lines) {
    lines.push(
      [
        "ligne",
        "visiteur",
        r.id,
        auditDetailAmountLabel(r.currency === "CDF" ? "CDF" : "USD", r.amountNominal, r.amountUsd),
        r.method,
        r.createdAt,
        esc(r.clientName),
      ].join(";"),
    );
  }
  for (const r of figures.counterSales.lines) {
    lines.push(
      [
        "ligne",
        "comptoir",
        r.id,
        String(r.amountCdf),
        r.method,
        r.createdAt,
        esc([r.label, r.pointOfSaleLabel, r.clientName].filter(Boolean).join(" · ")),
      ].join(";"),
    );
  }
  return lines.join("\r\n");
}

export function nightAuditRoutes(): Router {
  const r = createRouter();

  r.get("/summary", requireAuth, requireAnyPermission("accounting.close_day"), (req: Request, res: Response) => {
    const parsed = dateParam.safeParse(typeof req.query.date === "string" ? req.query.date : "");
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const businessDate = parsed.data;
    const figures = computeDayFigures(businessDate);
    const closure = db
      .prepare(
        `SELECT c.business_date, c.closed_at, c.closed_by_user_id, c.notes,
                c.expected_cash_usd, c.expected_cash_cdf, c.counted_cash_usd, c.counted_cash_cdf,
                c.fx_cdf_per_usd_snapshot, u.name AS closed_by_name
         FROM accounting_day_closures c
         LEFT JOIN users u ON u.id = c.closed_by_user_id
         WHERE c.business_date = ?`,
      )
      .get(businessDate) as ClosureRow | undefined;

    res.json({
      businessDate,
      ...figures,
      closure: closure ? closureRowToPublic(closure) : null,
    });
  });

  r.get("/closures", requireAuth, requireAnyPermission("accounting.close_day"), (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT c.business_date, c.closed_at, c.closed_by_user_id, c.notes,
                c.expected_cash_usd, c.expected_cash_cdf, c.counted_cash_usd, c.counted_cash_cdf,
                c.fx_cdf_per_usd_snapshot, u.name AS closed_by_name
         FROM accounting_day_closures c
         LEFT JOIN users u ON u.id = c.closed_by_user_id
         ORDER BY c.business_date DESC
         LIMIT 120`,
      )
      .all() as ClosureRow[];
    res.json({ closures: rows.map(closureRowToPublic) });
  });

  r.post("/close", requireAuth, requireAnyPermission("accounting.close_day"), (req: AuthedRequest, res: Response) => {
    const parsed = closeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const { businessDate, notes, countedCashUsd, countedCashCdf } = parsed.data;
    if (businessDate > todayUtcISODate()) {
      res.status(400).json({ code: "future_date" });
      return;
    }

    const exists = db.prepare("SELECT business_date FROM accounting_day_closures WHERE business_date = ?").get(
      businessDate,
    ) as { business_date: string } | undefined;
    if (exists) {
      res.status(409).json({ code: "already_closed" });
      return;
    }

    const figures = computeDayFigures(businessDate);
    const uid = req.auth?.sub ?? null;

    try {
      db.prepare(
        `INSERT INTO accounting_day_closures (
           business_date, closed_at, closed_by_user_id, notes,
           expected_cash_usd, expected_cash_cdf, counted_cash_usd, counted_cash_cdf, fx_cdf_per_usd_snapshot
         ) VALUES (
           @business_date, datetime('now'), @closed_by_user_id, @notes,
           @expected_cash_usd, @expected_cash_cdf, @counted_cash_usd, @counted_cash_cdf, @fx_cdf_per_usd_snapshot
         )`,
      ).run({
        business_date: businessDate,
        closed_by_user_id: uid,
        notes: notes.trim(),
        expected_cash_usd: figures.expectedCashUsd,
        expected_cash_cdf: figures.expectedCashCdf,
        counted_cash_usd: countedCashUsd ?? null,
        counted_cash_cdf: countedCashCdf ?? null,
        fx_cdf_per_usd_snapshot: figures.fxCdfPerUsd,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "server_error" });
      return;
    }

    const closure = db
      .prepare(
        `SELECT c.business_date, c.closed_at, c.closed_by_user_id, c.notes,
                c.expected_cash_usd, c.expected_cash_cdf, c.counted_cash_usd, c.counted_cash_cdf,
                c.fx_cdf_per_usd_snapshot, u.name AS closed_by_name
         FROM accounting_day_closures c
         LEFT JOIN users u ON u.id = c.closed_by_user_id
         WHERE c.business_date = ?`,
      )
      .get(businessDate) as ClosureRow;

    res.status(201).json({ closure: closureRowToPublic(closure), summary: { businessDate, ...figures } });
  });

  r.get("/export", requireAuth, requireAnyPermission("accounting.close_day"), (req: Request, res: Response) => {
    const d = dateParam.safeParse(typeof req.query.date === "string" ? req.query.date : "");
    const fmt = req.query.format === "json" ? "json" : "csv";
    if (!d.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const businessDate = d.data;
    const figures = computeDayFigures(businessDate);
    const closure = db
      .prepare(
        `SELECT c.business_date, c.closed_at, c.closed_by_user_id, c.notes,
                c.expected_cash_usd, c.expected_cash_cdf, c.counted_cash_usd, c.counted_cash_cdf,
                c.fx_cdf_per_usd_snapshot, u.name AS closed_by_name
         FROM accounting_day_closures c
         LEFT JOIN users u ON u.id = c.closed_by_user_id
         WHERE c.business_date = ?`,
      )
      .get(businessDate) as ClosureRow | undefined;

    if (fmt === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="cloture-${businessDate}.json"`,
      );
      res.send(
        JSON.stringify(
          {
            businessDate,
            generatedAt: new Date().toISOString(),
            closure: closure ? closureRowToPublic(closure) : null,
            ...figures,
          },
          null,
          2,
        ),
      );
      return;
    }

    let csv = buildCsv(businessDate, figures);
    if (closure) {
      const c = closureRowToPublic(closure);
      csv +=
        "\r\n" +
        [
          ["cloture", "horodatage", c.closedAt].join(";"),
          ["cloture", "par", c.closedByName ?? c.closedByUserId ?? ""].join(";"),
          ["cloture", "notes", `"${(c.notes ?? "").replace(/"/g, '""')}"`].join(";"),
          ["cloture", "compte_especes_usd", c.countedCashUsd == null ? "" : String(c.countedCashUsd)].join(";"),
          ["cloture", "compte_especes_cdf", c.countedCashCdf == null ? "" : String(c.countedCashCdf)].join(";"),
          ["cloture", "ecart_especes_usd", c.varianceCashUsd == null ? "" : String(c.varianceCashUsd)].join(";"),
          ["cloture", "ecart_especes_cdf", c.varianceCashCdf == null ? "" : String(c.varianceCashCdf)].join(";"),
        ].join("\r\n");
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cloture-${businessDate}.csv"`);
    res.send("\uFEFF" + csv);
  });

  return r;
}
