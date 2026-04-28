import { randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import {
  assignedPointOfSaleIdsForUser,
  roleSeesAllCashRegisterData,
  userMayAccessPointOfSale,
} from "../cashRegisterScope.js";
import {
  CASH_DAY_STATUS_READ_PERMS,
  localBusinessDateNow,
  requireCashDayOpenForRole,
} from "../cashDayOpen.js";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";

const TREASURY_PERMS = ["finance.treasury", "finance.counter"] as const;
/** Accès à la synthèse trésorerie (vue filtrée pour les caissiers / réception sans droit treasury). */
const TREASURY_OVERVIEW_PERMS = [
  "finance.treasury",
  "finance.counter",
  "lodging.reception_cash",
  "lodging.stay_reception",
] as const;
const TREASURY_MANAGE_PERMS = ["finance.treasury"] as const;
/** Dépôt rapport caisse réception (USD) : réception + trésorerie / paiements. */
const RECEPTION_REGISTER_PERMS = [
  "finance.treasury",
  "lodging.reception_cash",
  "lodging.stay_reception",
  "finance.payments",
] as const;

const createPointOfSaleSchema = z.object({
  code: z.string().min(1).max(64).trim(),
  label: z.string().min(1).max(200).trim(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isMain: z.boolean().optional().default(false),
});

const patchPointOfSaleSchema = z
  .object({
    code: z.string().min(1).max(64).trim().optional(),
    label: z.string().min(1).max(200).trim().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    active: z.boolean().optional(),
    isMain: z.boolean().optional(),
  })
  .refine((o) => o.code !== undefined || o.label !== undefined || o.sortOrder !== undefined || o.active !== undefined || o.isMain !== undefined, {
    message: "empty_patch",
  });

const upsertReportSchema = z.object({
  pointOfSaleId: z.string().min(1).max(80),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openingFloatCdf: z.number().int().min(0).max(999_999_999),
  countedCashCdf: z.number().int().min(0).max(999_999_999),
  notesCashier: z.string().max(1000).optional().default(""),
});

const validateReportSchema = z.object({
  targetAccountId: z.string().min(1).max(80).optional(),
  /** Montant CDF à comptabiliser (défaut : espèces comptées en caisse). */
  amountCdf: z.number().int().min(0).max(999_999_999).optional(),
  notesTreasury: z.string().max(500).optional().default(""),
});

const upsertReceptionReportSchema = z.object({
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openingFloatUsd: z.number().int().min(0).max(999_999_999),
  countedCashUsd: z.number().int().min(0).max(999_999_999),
  notesCashier: z.string().max(1000).optional().default(""),
});

const validateReceptionReportSchema = z.object({
  targetAccountId: z.string().min(1).max(80).optional(),
  amountUsd: z.number().int().min(0).max(999_999_999).optional(),
  notesTreasury: z.string().max(500).optional().default(""),
});

const counterDayOpeningRowSchema = z.object({
  pointOfSaleId: z.string().min(1).max(80),
  openingFloatCdf: z.number().int().min(0).max(999_999_999),
});

const openCashDaySchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional().default(""),
  /** Fond d’ouverture caisse réception (USD), saisi par la trésorerie. */
  receptionOpeningFloatUsd: z.number().int().min(0).max(999_999_999).optional().default(0),
  /** Fonds d’ouverture par point de vente comptoir (CDF) ; caisses non listées restent saisissables par le caissier. */
  counterOpenings: z.array(counterDayOpeningRowSchema).max(100).optional().default([]),
});

type RollupRow = {
  point_of_sale_id: string | null;
  point_of_sale_label: string | null;
  day: string;
  total_cdf: number;
  cash_cdf: number;
  non_cash_cdf: number;
  sale_count: number;
};

type ReportDbRow = {
  id: string;
  point_of_sale_id: string;
  report_date: string;
  opening_float_cdf: number;
  counted_cash_cdf: number;
  notes_cashier: string;
  submitted_by_user_id: string | null;
  submitted_at: string;
  point_of_sale_label: string | null;
  submitted_by_name: string | null;
  status: string | null;
  validated_at: string | null;
  validated_by_user_id: string | null;
  cash_book_movement_id: string | null;
  notes_treasury: string | null;
  validated_by_name: string | null;
};

const TREASURY_REPORT_SELECT = `
           SELECT r.id, r.point_of_sale_id, r.report_date, r.opening_float_cdf, r.counted_cash_cdf,
                  r.notes_cashier, r.submitted_by_user_id, r.submitted_at,
                  COALESCE(r.status, 'submitted') AS status,
                  r.validated_at, r.validated_by_user_id, r.cash_book_movement_id, r.notes_treasury,
                  p.label AS point_of_sale_label,
                  u.name AS submitted_by_name,
                  vu.name AS validated_by_name
           FROM treasury_register_reports r
           LEFT JOIN stock_points_of_sale p ON p.id = r.point_of_sale_id
           LEFT JOIN users u ON u.id = r.submitted_by_user_id
           LEFT JOIN users vu ON vu.id = r.validated_by_user_id`;

function treasuryReportToPublic(row: ReportDbRow) {
  const cashSales =
    row.submitted_by_user_id
      ? cashSalesCdfForPosDayAndCashier(row.point_of_sale_id, row.report_date, row.submitted_by_user_id)
      : cashSalesCdfForPosDay(row.point_of_sale_id, row.report_date);
  const expectedCashCdf = row.opening_float_cdf + cashSales;
  const varianceCdf = row.counted_cash_cdf - expectedCashCdf;
  const st = row.status === "validated" ? "validated" : "submitted";
  return {
    id: row.id,
    pointOfSaleId: row.point_of_sale_id,
    pointOfSaleLabel: row.point_of_sale_label,
    reportDate: row.report_date,
    openingFloatCdf: row.opening_float_cdf,
    countedCashCdf: row.counted_cash_cdf,
    notesCashier: row.notes_cashier,
    submittedByUserId: row.submitted_by_user_id,
    submittedByName: row.submitted_by_name,
    submittedAt: row.submitted_at,
    status: st,
    validatedAt: row.validated_at,
    validatedByUserId: row.validated_by_user_id,
    validatedByName: row.validated_by_name,
    cashBookMovementId: row.cash_book_movement_id,
    notesTreasury: row.notes_treasury ?? "",
    systemCashSalesCdf: cashSales,
    expectedCashCdf,
    varianceCdf,
  };
}

function getDefaultRemittanceAccountId(currency: "CDF" | "USD" = "CDF"): string | undefined {
  const row = db
    .prepare(
      `SELECT id FROM finance_cash_accounts
       WHERE active = 1 AND kind = 'physical' AND currency = ?
       ORDER BY sort_order ASC, label ASC LIMIT 1`,
    )
    .get(currency) as { id: string } | undefined;
  return row?.id;
}

function getPhysicalCashAccount(id: string, currency: "CDF" | "USD"): { id: string } | undefined {
  return db
    .prepare(
      `SELECT id FROM finance_cash_accounts
       WHERE id = ? AND active = 1 AND kind = 'physical' AND currency = ?`,
    )
    .get(id, currency) as { id: string } | undefined;
}

function parseDateRange(req: Request): { from: string; to: string } | null {
  const fromRaw = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const toRaw = typeof req.query.to === "string" ? req.query.to.trim() : "";
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromRaw) || !re.test(toRaw)) return null;
  if (fromRaw > toRaw) return null;
  return { from: fromRaw, to: toRaw };
}

function cashSalesCdfForPosDay(pointOfSaleId: string, reportDate: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cdf), 0) AS s
       FROM counter_sales
       WHERE point_of_sale_id = ?
         AND date(created_at) = date(?)
         AND method = 'Espèces'`,
    )
    .get(pointOfSaleId, reportDate) as { s: number };
  return row?.s ?? 0;
}

/** Espèces CDF enregistrées par un caissier précis sur une caisse et un jour. */
function cashSalesCdfForPosDayAndCashier(
  pointOfSaleId: string,
  reportDate: string,
  cashierUserId: string,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cdf), 0) AS s
       FROM counter_sales
       WHERE point_of_sale_id = ?
         AND date(created_at) = date(?)
         AND method = 'Espèces'
         AND created_by_user_id = ?`,
    )
    .get(pointOfSaleId, reportDate, cashierUserId) as { s: number };
  return row?.s ?? 0;
}

/** Espèces USD enregistrées pour un caissier réception sur une date (séjours + droits d’entrée). */
function receptionCashUsdBreakdownForCashier(reportDate: string, cashierUserId: string): {
  reservationPaymentsCashUsd: number;
  visitorEntryCashUsd: number;
} {
  const rp = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(amount_usd_equivalent, amount)), 0) AS s
       FROM reservation_payments
       WHERE method = 'Espèces' AND date(created_at) = date(?) AND received_by_user_id = ?`,
    )
    .get(reportDate, cashierUserId) as { s: number };
  const ve = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS s
       FROM visitor_entry_payment_ledger
       WHERE method = 'Espèces' AND date(created_at) = date(?) AND received_by_user_id = ?`,
    )
    .get(reportDate, cashierUserId) as { s: number };
  return {
    reservationPaymentsCashUsd: rp?.s ?? 0,
    visitorEntryCashUsd: ve?.s ?? 0,
  };
}

function receptionCashUsdForDay(reportDate: string, receivedByUserId: string | null): number {
  if (receivedByUserId) {
    const b = receptionCashUsdBreakdownForCashier(reportDate, receivedByUserId);
    return b.reservationPaymentsCashUsd + b.visitorEntryCashUsd;
  }
  const rp = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(amount_usd_equivalent, amount)), 0) AS s
       FROM reservation_payments
       WHERE method = 'Espèces' AND date(created_at) = date(?)`,
    )
    .get(reportDate) as { s: number };
  const ve = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS s
       FROM visitor_entry_payment_ledger
       WHERE method = 'Espèces' AND date(created_at) = date(?)`,
    )
    .get(reportDate) as { s: number };
  return (rp?.s ?? 0) + (ve?.s ?? 0);
}

type ReceptionReportDbRow = {
  id: string;
  report_date: string;
  report_owner_user_id: string;
  opening_float_usd: number;
  counted_cash_usd: number;
  notes_cashier: string;
  submitted_by_user_id: string | null;
  submitted_at: string;
  status: string | null;
  validated_at: string | null;
  validated_by_user_id: string | null;
  cash_book_movement_id: string | null;
  notes_treasury: string | null;
  submitted_by_name: string | null;
  validated_by_name: string | null;
};

const RECEPTION_REPORT_SELECT = `
           SELECT r.id, r.report_date, r.report_owner_user_id, r.opening_float_usd, r.counted_cash_usd,
                  r.notes_cashier, r.submitted_by_user_id, r.submitted_at,
                  COALESCE(r.status, 'submitted') AS status,
                  r.validated_at, r.validated_by_user_id, r.cash_book_movement_id, r.notes_treasury,
                  u.name AS submitted_by_name,
                  vu.name AS validated_by_name FROM reception_register_reports r
           LEFT JOIN users u ON u.id = r.submitted_by_user_id
           LEFT JOIN users vu ON vu.id = r.validated_by_user_id`;

function receptionReportToPublic(row: ReceptionReportDbRow) {
  const cashSales = receptionCashUsdForDay(row.report_date, row.report_owner_user_id);
  const expectedCashUsd = row.opening_float_usd + cashSales;
  const varianceUsd = row.counted_cash_usd - expectedCashUsd;
  const st = row.status === "validated" ? "validated" : "submitted";
  return {
    id: row.id,
    reportDate: row.report_date,
    reportOwnerUserId: row.report_owner_user_id,
    openingFloatUsd: row.opening_float_usd,
    countedCashUsd: row.counted_cash_usd,
    notesCashier: row.notes_cashier,
    submittedByUserId: row.submitted_by_user_id,
    submittedByName: row.submitted_by_name,
    submittedAt: row.submitted_at,
    status: st,
    validatedAt: row.validated_at,
    validatedByUserId: row.validated_by_user_id,
    validatedByName: row.validated_by_name,
    cashBookMovementId: row.cash_book_movement_id,
    notesTreasury: row.notes_treasury ?? "",
    systemCashSalesUsd: cashSales,
    expectedCashUsd,
    varianceUsd,
  };
}

type PosManageRow = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  is_main: number;
  active: number;
  stock_location_id: string;
  stock_location_label: string;
};

function codeTakenElsewhere(code: string, excludePosId?: string, excludeLocId?: string): boolean {
  const posRow = excludePosId
    ? (db
        .prepare("SELECT id FROM stock_points_of_sale WHERE code = ? COLLATE NOCASE AND id != ?")
        .get(code, excludePosId) as { id: string } | undefined)
    : (db.prepare("SELECT id FROM stock_points_of_sale WHERE code = ? COLLATE NOCASE").get(code) as { id: string } | undefined);
  if (posRow) return true;
  const locRow = excludeLocId
    ? (db
        .prepare("SELECT id FROM stock_locations WHERE code = ? COLLATE NOCASE AND id != ?")
        .get(code, excludeLocId) as { id: string } | undefined)
    : (db.prepare("SELECT id FROM stock_locations WHERE code = ? COLLATE NOCASE").get(code) as { id: string } | undefined);
  return !!locRow;
}

function clearAllMainFlags(): void {
  db.prepare(`UPDATE stock_points_of_sale SET is_main = 0`).run();
}

function ensureOneActiveMain(): void {
  const n = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM stock_points_of_sale WHERE active = 1 AND is_main = 1`)
      .get() as { c: number }
  ).c;
  if (n > 0) return;
  const pick = db
    .prepare(
      `SELECT id FROM stock_points_of_sale WHERE active = 1 ORDER BY sort_order ASC, code COLLATE NOCASE ASC LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (pick) {
    db.prepare(`UPDATE stock_points_of_sale SET is_main = 1 WHERE id = ?`).run(pick.id);
  }
}

function rowToTreasuryManagePublic(row: PosManageRow) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sort_order,
    isMain: row.is_main === 1,
    active: row.active === 1,
    stockLocationId: row.stock_location_id,
    stockLocationLabel: row.stock_location_label,
  };
}

type CounterOpeningRowIn = { pointOfSaleId: string; openingFloatCdf: number };

function validateCounterOpeningRows(counterOpeningsRaw: CounterOpeningRowIn[], res: Response): boolean {
  const seenPos = new Set<string>();
  for (const co of counterOpeningsRaw) {
    const pid = co.pointOfSaleId.trim();
    if (seenPos.has(pid)) {
      res.status(400).json({ code: "validation_error" });
      return false;
    }
    seenPos.add(pid);
    const posOk = db
      .prepare("SELECT 1 FROM stock_points_of_sale WHERE id = ? AND active = 1")
      .get(pid);
    if (!posOk) {
      res.status(400).json({ code: "unknown_point_of_sale" });
      return false;
    }
  }
  return true;
}

const patchCashDayOpeningsSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receptionOpeningFloatUsd: z.number().int().min(0).max(999_999_999),
  counterOpenings: z.array(counterDayOpeningRowSchema).max(100),
});

export function treasuryRoutes(): Router {
  const r = createRouter();

  r.get(
    "/overview",
    requireAuth,
    requireAnyPermission(...TREASURY_OVERVIEW_PERMS),
    (req: AuthedRequest, res: Response) => {
      const range = parseDateRange(req);
      if (!range) {
        res.status(400).json({ code: "invalid_date_range" });
        return;
      }

      const role = req.auth?.role ?? "";
      const userId = req.auth?.sub ?? "";
      const globalView = roleSeesAllCashRegisterData(role);

      let rollupRows: RollupRow[] = [];
      if (globalView) {
        rollupRows = db
          .prepare(
            `SELECT
               s.point_of_sale_id AS point_of_sale_id,
               p.label AS point_of_sale_label,
               date(s.created_at) AS day,
               SUM(s.amount_cdf) AS total_cdf,
               SUM(CASE WHEN s.method = 'Espèces' THEN s.amount_cdf ELSE 0 END) AS cash_cdf,
               SUM(CASE WHEN s.method != 'Espèces' THEN s.amount_cdf ELSE 0 END) AS non_cash_cdf,
               COUNT(*) AS sale_count
             FROM counter_sales s
             LEFT JOIN stock_points_of_sale p ON p.id = s.point_of_sale_id
             WHERE date(s.created_at) >= date(?)
               AND date(s.created_at) <= date(?)
             GROUP BY s.point_of_sale_id, date(s.created_at)
             ORDER BY day DESC, COALESCE(p.label, '') ASC`,
          )
          .all(range.from, range.to) as RollupRow[];
      } else {
        const posIds = assignedPointOfSaleIdsForUser(userId);
        if (posIds.length > 0) {
          const ph = posIds.map(() => "?").join(",");
          rollupRows = db
            .prepare(
              `SELECT
                 s.point_of_sale_id AS point_of_sale_id,
                 p.label AS point_of_sale_label,
                 date(s.created_at) AS day,
                 SUM(s.amount_cdf) AS total_cdf,
                 SUM(CASE WHEN s.method = 'Espèces' THEN s.amount_cdf ELSE 0 END) AS cash_cdf,
                 SUM(CASE WHEN s.method != 'Espèces' THEN s.amount_cdf ELSE 0 END) AS non_cash_cdf,
                 COUNT(*) AS sale_count
               FROM counter_sales s
               LEFT JOIN stock_points_of_sale p ON p.id = s.point_of_sale_id
               WHERE date(s.created_at) >= date(?)
                 AND date(s.created_at) <= date(?)
                 AND s.point_of_sale_id IN (${ph})
                 AND s.created_by_user_id = ?
               GROUP BY s.point_of_sale_id, date(s.created_at)
               ORDER BY day DESC, COALESCE(p.label, '') ASC`,
            )
            .all(range.from, range.to, ...posIds, userId) as RollupRow[];
        }
      }

      let reportRows: ReportDbRow[] = [];
      if (globalView) {
        reportRows = db
          .prepare(
            `${TREASURY_REPORT_SELECT}
 WHERE date(r.report_date) >= date(?)
               AND date(r.report_date) <= date(?)
             ORDER BY r.report_date DESC, COALESCE(p.label, '') ASC, r.submitted_at DESC`,
          )
          .all(range.from, range.to) as ReportDbRow[];
      } else {
        const posIds = assignedPointOfSaleIdsForUser(userId);
        if (posIds.length > 0) {
          const ph = posIds.map(() => "?").join(",");
          reportRows = db
            .prepare(
              `${TREASURY_REPORT_SELECT}
               WHERE date(r.report_date) >= date(?)
                 AND date(r.report_date) <= date(?)
                 AND r.submitted_by_user_id = ?
                 AND r.point_of_sale_id IN (${ph})
               ORDER BY r.report_date DESC, COALESCE(p.label, '') ASC, r.submitted_at DESC`,
            )
            .all(range.from, range.to, userId, ...posIds) as ReportDbRow[];
        }
      }

      const reports = reportRows.map((row) => treasuryReportToPublic(row));

      let receptionRows: ReceptionReportDbRow[] = [];
      if (globalView) {
        receptionRows = db
          .prepare(
            `${RECEPTION_REPORT_SELECT}
             WHERE date(r.report_date) >= date(?)
               AND date(r.report_date) <= date(?)
             ORDER BY r.report_date DESC, r.submitted_at DESC`,
          )
          .all(range.from, range.to) as ReceptionReportDbRow[];
      } else {
        receptionRows = db
          .prepare(
            `${RECEPTION_REPORT_SELECT}
             WHERE date(r.report_date) >= date(?)
               AND date(r.report_date) <= date(?)
               AND r.report_owner_user_id = ?
             ORDER BY r.report_date DESC, r.submitted_at DESC`,
          )
          .all(range.from, range.to, userId) as ReceptionReportDbRow[];
      }

      const todayBd = localBusinessDateNow();
      const cashDayRow = db
        .prepare(
          `SELECT o.opened_at, o.reception_opening_float_usd, u.name AS opened_by_name
           FROM treasury_cash_day_openings o
           LEFT JOIN users u ON u.id = o.opened_by_user_id
           WHERE o.business_date = ?`,
        )
        .get(todayBd) as
        | {
            opened_at: string;
            reception_opening_float_usd: number;
            opened_by_name: string | null;
          }
        | undefined;

      let counterTreasuryOpenings:
        | { pointOfSaleId: string; pointOfSaleLabel: string; openingFloatCdf: number }[]
        | undefined;
      if (cashDayRow) {
        counterTreasuryOpenings = db
          .prepare(
            `SELECT p.point_of_sale_id AS pointOfSaleId,
                    COALESCE(s.label, p.point_of_sale_id) AS pointOfSaleLabel,
                    p.opening_float_cdf AS openingFloatCdf
             FROM treasury_cash_day_pos_openings p
             LEFT JOIN stock_points_of_sale s ON s.id = p.point_of_sale_id
             WHERE p.business_date = ?
             ORDER BY COALESCE(s.sort_order, 9999) ASC, pointOfSaleLabel ASC`,
          )
          .all(todayBd) as { pointOfSaleId: string; pointOfSaleLabel: string; openingFloatCdf: number }[];
      }

      res.json({
        from: range.from,
        to: range.to,
        cashDayToday: {
          businessDate: todayBd,
          opened: !!cashDayRow,
          openedAt: cashDayRow?.opened_at ?? null,
          openedByName: cashDayRow?.opened_by_name ?? null,
          ...(cashDayRow
            ? {
                receptionOpeningFloatUsd: cashDayRow.reception_opening_float_usd ?? 0,
                counterTreasuryOpenings: counterTreasuryOpenings ?? [],
              }
            : {}),
        },
        counterRollup: rollupRows.map((x) => ({
          pointOfSaleId: x.point_of_sale_id,
          pointOfSaleLabel: x.point_of_sale_label,
          day: x.day,
          totalCdf: x.total_cdf,
          cashCdf: x.cash_cdf,
          nonCashCdf: x.non_cash_cdf,
          saleCount: x.sale_count,
        })),
        registerReports: reports,
        receptionRegisterReports: receptionRows.map((row) => receptionReportToPublic(row)),
      });
    },
  );

  r.get(
    "/cash-day-status",
    requireAuth,
    requireAnyPermission(...CASH_DAY_STATUS_READ_PERMS),
    (req: Request, res: Response) => {
      const raw = typeof req.query.date === "string" ? req.query.date.trim() : "";
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localBusinessDateNow();
      const row = db
        .prepare(
          `SELECT o.opened_at, o.reception_opening_float_usd, u.name AS opened_by_name
           FROM treasury_cash_day_openings o
           LEFT JOIN users u ON u.id = o.opened_by_user_id
           WHERE o.business_date = ?`,
        )
        .get(date) as
        | {
            opened_at: string;
            reception_opening_float_usd: number;
            opened_by_name: string | null;
          }
        | undefined;
      let counterTreasuryOpenings:
        | { pointOfSaleId: string; pointOfSaleLabel: string; openingFloatCdf: number }[]
        | undefined;
      if (row) {
        counterTreasuryOpenings = db
          .prepare(
            `SELECT p.point_of_sale_id AS pointOfSaleId,
                    COALESCE(s.label, p.point_of_sale_id) AS pointOfSaleLabel,
                    p.opening_float_cdf AS openingFloatCdf
             FROM treasury_cash_day_pos_openings p
             LEFT JOIN stock_points_of_sale s ON s.id = p.point_of_sale_id
             WHERE p.business_date = ?
             ORDER BY COALESCE(s.sort_order, 9999) ASC, pointOfSaleLabel ASC`,
          )
          .all(date) as { pointOfSaleId: string; pointOfSaleLabel: string; openingFloatCdf: number }[];
      }
      res.json({
        businessDate: date,
        opened: !!row,
        openedAt: row?.opened_at ?? null,
        openedByName: row?.opened_by_name ?? null,
        ...(row
          ? {
              receptionOpeningFloatUsd: row.reception_opening_float_usd ?? 0,
              counterTreasuryOpenings: counterTreasuryOpenings ?? [],
            }
          : {}),
      });
    },
  );

  r.post(
    "/cash-day-openings",
    requireAuth,
    requireAnyPermission(...TREASURY_MANAGE_PERMS),
    (req: AuthedRequest, res: Response) => {
      const parsed = openCashDaySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const uid = req.auth?.sub ?? "";
      if (!uid) {
        res.status(401).json({ code: "unauthorized" });
        return;
      }
      const businessDate = parsed.data.businessDate?.trim() || localBusinessDateNow();
      const notes = parsed.data.notes.trim();
      const receptionOpeningFloatUsd = parsed.data.receptionOpeningFloatUsd ?? 0;
      const counterOpeningsRaw = parsed.data.counterOpenings ?? [];

      if (!validateCounterOpeningRows(counterOpeningsRaw, res)) return;

      const existing = db
        .prepare(
          `SELECT o.business_date, o.opened_at, u.name AS opened_by_name
           FROM treasury_cash_day_openings o
           LEFT JOIN users u ON u.id = o.opened_by_user_id
           WHERE o.business_date = ?`,
        )
        .get(businessDate) as
          | { business_date: string; opened_at: string; opened_by_name: string | null }
          | undefined;

      if (existing) {
        res.status(200).json({
          businessDate,
          alreadyOpen: true,
          openedAt: existing.opened_at,
          openedByName: existing.opened_by_name,
        });
        return;
      }

      try {
        const runOpen = db.transaction(() => {
          db.prepare(
            `INSERT INTO treasury_cash_day_openings (business_date, opened_at, opened_by_user_id, notes, reception_opening_float_usd)
             VALUES (@d, datetime('now'), @uid, @notes, @recUsd)`,
          ).run({ d: businessDate, uid, notes, recUsd: receptionOpeningFloatUsd });
          const insPos = db.prepare(
            `INSERT INTO treasury_cash_day_pos_openings (business_date, point_of_sale_id, opening_float_cdf)
             VALUES (?, ?, ?)`,
          );
          for (const co of counterOpeningsRaw) {
            insPos.run(businessDate, co.pointOfSaleId.trim(), co.openingFloatCdf);
          }
        });
        runOpen();
      } catch (e) {
        console.error(e);
        res.status(500).json({ code: "insert_failed" });
        return;
      }

      const row = db
        .prepare(
          `SELECT o.opened_at, u.name AS opened_by_name
           FROM treasury_cash_day_openings o
           LEFT JOIN users u ON u.id = o.opened_by_user_id
           WHERE o.business_date = ?`,
        )
        .get(businessDate) as { opened_at: string; opened_by_name: string | null };

      res.status(201).json({
        businessDate,
        alreadyOpen: false,
        openedAt: row.opened_at,
        openedByName: row.opened_by_name,
      });
    },
  );

  /** Corriger les fonds d’ouverture (réception + comptoirs) pour une journée déjà ouverte. */
  r.patch(
    "/cash-day-openings",
    requireAuth,
    requireAnyPermission(...TREASURY_MANAGE_PERMS),
    (req: AuthedRequest, res: Response) => {
      const parsed = patchCashDayOpeningsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const businessDate = parsed.data.businessDate.trim();
      const receptionOpeningFloatUsd = parsed.data.receptionOpeningFloatUsd;
      const counterOpeningsRaw = parsed.data.counterOpenings;

      if (!validateCounterOpeningRows(counterOpeningsRaw, res)) return;

      const existing = db
        .prepare(`SELECT business_date FROM treasury_cash_day_openings WHERE business_date = ?`)
        .get(businessDate) as { business_date: string } | undefined;
      if (!existing) {
        res.status(404).json({ code: "cash_day_not_opened" });
        return;
      }

      try {
        const runPatch = db.transaction(() => {
          db.prepare(
            `UPDATE treasury_cash_day_openings SET reception_opening_float_usd = @rec WHERE business_date = @d`,
          ).run({ d: businessDate, rec: receptionOpeningFloatUsd });
          db.prepare(`DELETE FROM treasury_cash_day_pos_openings WHERE business_date = ?`).run(businessDate);
          const insPos = db.prepare(
            `INSERT INTO treasury_cash_day_pos_openings (business_date, point_of_sale_id, opening_float_cdf)
             VALUES (?, ?, ?)`,
          );
          for (const co of counterOpeningsRaw) {
            insPos.run(businessDate, co.pointOfSaleId.trim(), co.openingFloatCdf);
          }
        });
        runPatch();
      } catch (e) {
        console.error(e);
        res.status(500).json({ code: "update_failed" });
        return;
      }

      const counterTreasuryOpenings = db
        .prepare(
          `SELECT p.point_of_sale_id AS pointOfSaleId,
                    COALESCE(s.label, p.point_of_sale_id) AS pointOfSaleLabel,
                    p.opening_float_cdf AS openingFloatCdf
             FROM treasury_cash_day_pos_openings p
             LEFT JOIN stock_points_of_sale s ON s.id = p.point_of_sale_id
             WHERE p.business_date = ?
             ORDER BY COALESCE(s.sort_order, 9999) ASC, pointOfSaleLabel ASC`,
        )
        .all(businessDate) as { pointOfSaleId: string; pointOfSaleLabel: string; openingFloatCdf: number }[];

      res.status(200).json({
        businessDate,
        receptionOpeningFloatUsd,
        counterTreasuryOpenings,
      });
    },
  );

  /** Aperçu pour le caissier : espèces USD enregistrées à son nom (séjour + visiteur) avant clôture réception. */
  r.get(
    "/cash-register-situation/reception",
    requireAuth,
    requireAnyPermission(...RECEPTION_REGISTER_PERMS),
    (req: AuthedRequest, res: Response) => {
      const reportDate = typeof req.query.date === "string" ? req.query.date.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const role = req.auth?.role ?? "";
      const uid = req.auth?.sub ?? "";
      if (!uid) {
        res.status(401).json({ code: "unauthorized" });
        return;
      }
      if (!requireCashDayOpenForRole(role, reportDate, res)) return;
      const b = receptionCashUsdBreakdownForCashier(reportDate, uid);
      const systemCashSalesUsd = b.reservationPaymentsCashUsd + b.visitorEntryCashUsd;
      const dayOpening = db
        .prepare(
          `SELECT reception_opening_float_usd FROM treasury_cash_day_openings WHERE business_date = ?`,
        )
        .get(reportDate) as { reception_opening_float_usd: number } | undefined;
      res.json({
        businessDate: reportDate,
        reservationPaymentsCashUsd: b.reservationPaymentsCashUsd,
        visitorEntryCashUsd: b.visitorEntryCashUsd,
        systemCashSalesUsd,
        treasuryOpeningFloatUsd: dayOpening?.reception_opening_float_usd ?? 0,
      });
    },
  );

  /** Aperçu pour le caissier comptoir : ventes du jour sur la caisse choisie, à son nom, avant clôture. */
  r.get(
    "/cash-register-situation/counter",
    requireAuth,
    requireAnyPermission(...TREASURY_PERMS),
    (req: AuthedRequest, res: Response) => {
      const reportDate = typeof req.query.date === "string" ? req.query.date.trim() : "";
      const posId = typeof req.query.pointOfSaleId === "string" ? req.query.pointOfSaleId.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !posId) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const role = req.auth?.role ?? "";
      const uid = req.auth?.sub ?? "";
      if (!uid) {
        res.status(401).json({ code: "unauthorized" });
        return;
      }
      const posRow = db
        .prepare("SELECT id, label FROM stock_points_of_sale WHERE id = ? AND active = 1")
        .get(posId) as { id: string; label: string } | undefined;
      if (!posRow) {
        res.status(400).json({ code: "unknown_point_of_sale" });
        return;
      }
      if (!userMayAccessPointOfSale(role, uid, posId)) {
        res.status(403).json({ code: "forbidden_point_of_sale" });
        return;
      }
      if (!requireCashDayOpenForRole(role, reportDate, res)) return;
      const systemCashSalesCdf = cashSalesCdfForPosDayAndCashier(posId, reportDate, uid);
      const totals = db
        .prepare(
          `SELECT COALESCE(SUM(amount_cdf), 0) AS total, COUNT(*) AS n
           FROM counter_sales
           WHERE point_of_sale_id = ? AND date(created_at) = date(?) AND created_by_user_id = ?`,
        )
        .get(posId, reportDate, uid) as { total: number; n: number };
      const posOpening = db
        .prepare(
          `SELECT opening_float_cdf FROM treasury_cash_day_pos_openings WHERE business_date = ? AND point_of_sale_id = ?`,
        )
        .get(reportDate, posId) as { opening_float_cdf: number } | undefined;
      res.json({
        businessDate: reportDate,
        pointOfSaleId: posId,
        pointOfSaleLabel: posRow.label,
        systemCashSalesCdf,
        totalSalesCdf: totals?.total ?? 0,
        saleCount: totals?.n ?? 0,
        treasuryOpeningFloatCdf: posOpening ? posOpening.opening_float_cdf : null,
      });
    },
  );

  r.post(
    "/register-reports",
    requireAuth,
    requireAnyPermission(...TREASURY_PERMS),
    (req: AuthedRequest, res: Response) => {
      const parsed = upsertReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const { pointOfSaleId, reportDate, openingFloatCdf, countedCashCdf, notesCashier } = parsed.data;
      const posOk = db
        .prepare("SELECT 1 FROM stock_points_of_sale WHERE id = ? AND active = 1")
        .get(pointOfSaleId);
      if (!posOk) {
        res.status(400).json({ code: "unknown_point_of_sale" });
        return;
      }

      const role = req.auth?.role ?? "";
      const uid = req.auth?.sub ?? "";
      if (!userMayAccessPointOfSale(role, uid, pointOfSaleId)) {
        res.status(403).json({ code: "forbidden_point_of_sale" });
        return;
      }

      if (!requireCashDayOpenForRole(role, reportDate, res)) return;

      const existing = db
        .prepare(`SELECT status FROM treasury_register_reports WHERE point_of_sale_id = ? AND report_date = ?`)
        .get(pointOfSaleId, reportDate) as { status: string | null } | undefined;
      if (existing?.status === "validated") {
        res.status(409).json({ code: "report_already_validated" });
        return;
      }

      const treasuryPosOpening = db
        .prepare(
          `SELECT opening_float_cdf FROM treasury_cash_day_pos_openings WHERE business_date = ? AND point_of_sale_id = ?`,
        )
        .get(reportDate, pointOfSaleId) as { opening_float_cdf: number } | undefined;
      const effectiveOpeningFloatCdf = treasuryPosOpening
        ? treasuryPosOpening.opening_float_cdf
        : openingFloatCdf;

      const id = randomUUID();
      const userId = req.auth?.sub ?? null;

      try {
        db.prepare(
          `INSERT INTO treasury_register_reports
 (id, point_of_sale_id, report_date, opening_float_cdf, counted_cash_cdf, notes_cashier, submitted_by_user_id, status, notes_treasury)
           VALUES (@id, @point_of_sale_id, @report_date, @opening_float_cdf, @counted_cash_cdf, @notes_cashier, @submitted_by_user_id, 'submitted', '')
           ON CONFLICT(point_of_sale_id, report_date) DO UPDATE SET
             opening_float_cdf = excluded.opening_float_cdf,
             counted_cash_cdf = excluded.counted_cash_cdf,
             notes_cashier = excluded.notes_cashier,
             submitted_by_user_id = excluded.submitted_by_user_id,
             submitted_at = datetime('now'),
             status = 'submitted',
             validated_at = NULL,
             validated_by_user_id = NULL,
             cash_book_movement_id = NULL,
             notes_treasury = ''`,
        ).run({
          id,
          point_of_sale_id: pointOfSaleId,
          report_date: reportDate,
          opening_float_cdf: effectiveOpeningFloatCdf,
          counted_cash_cdf: countedCashCdf,
          notes_cashier: notesCashier.trim(),
          submitted_by_user_id: userId,
        });
      } catch (e) {
        console.error(e);
        res.status(500).json({ code: "insert_failed" });
        return;
      }

      const row = db
        .prepare(`${TREASURY_REPORT_SELECT} WHERE r.point_of_sale_id = ? AND r.report_date = ?`)
        .get(pointOfSaleId, reportDate) as ReportDbRow;

      res.status(201).json({
        report: treasuryReportToPublic(row),
      });
    },
  );

  r.get(
    "/cash-remittance-accounts",
    requireAuth,
    requireAnyPermission(...TREASURY_MANAGE_PERMS),
    (req: Request, res: Response) => {
      const curRaw = typeof req.query.currency === "string" ? req.query.currency.trim().toUpperCase() : "";
      const currency: "CDF" | "USD" = curRaw === "USD" ? "USD" : "CDF";
      const rows = db
        .prepare(
          `SELECT id, code, label, sort_order AS sortOrder
           FROM finance_cash_accounts
           WHERE active = 1 AND kind = 'physical' AND currency = ?
           ORDER BY sort_order ASC, label ASC`,
        )
        .all(currency) as { id: string; code: string; label: string; sortOrder: number }[];
      res.json({ accounts: rows, currency });
    },
  );

  r.post(
    "/register-reports/:reportId/validate",
    requireAuth,
    requireAnyPermission(...TREASURY_MANAGE_PERMS),
    (req: AuthedRequest, res: Response) => {
      const reportId = typeof req.params.reportId === "string" ? req.params.reportId.trim() : "";
      if (!reportId) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const parsed = validateReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }

      const row = db.prepare(`${TREASURY_REPORT_SELECT} WHERE r.id = ?`).get(reportId) as ReportDbRow | undefined;
      if (!row) {
        res.status(404).json({ code: "not_found" });
        return;
      }
      if (row.status === "validated") {
        res.status(409).json({ code: "already_validated" });
        return;
      }

      const amountCdf =
        parsed.data.amountCdf !== undefined ? parsed.data.amountCdf : row.counted_cash_cdf;

      let targetId: string | null = null;
           if (amountCdf > 0) {
        const tid = parsed.data.targetAccountId?.trim() || getDefaultRemittanceAccountId("CDF");
        if (!tid) {
          res.status(400).json({ code: "no_cash_account" });
          return;
        }
        if (!getPhysicalCashAccount(tid, "CDF")) {
          res.status(400).json({ code: "unknown_account" });
          return;
        }
        targetId = tid;
      }
      const userId = req.auth?.sub ?? null;
      const posLabel = row.point_of_sale_label ?? row.point_of_sale_id;
      const noteParts = [
        `Rapport caisse ${posLabel} · ${row.report_date}.`,
        `Compté ${row.counted_cash_cdf} FC, fond ${row.opening_float_cdf} FC.`,
        row.notes_cashier ? `Caissier : ${row.notes_cashier}` : "",
        parsed.data.notesTreasury.trim() ? `Trésorerie : ${parsed.data.notesTreasury.trim()}` : "",
      ];
      const movementNote = noteParts.filter(Boolean).join(" ");

      try {
        const run = db.transaction(() => {
          let movementId: string | null = null;
          if (amountCdf > 0) {
            movementId = randomUUID();
            db.prepare(
              `INSERT INTO finance_cash_movements
               (id, category, occurred_at, source_account_id, target_account_id, amount, currency, label, note, created_by_user_id)
               VALUES (@id, 'adjustment_in', @occurred_at, NULL, @target_account_id, @amount, 'CDF', @label, @note, @created_by_user_id)`,
            ).run({
              id: movementId,
              occurred_at: `${row.report_date}T12:00:00`,
              target_account_id: targetId!,
              amount: amountCdf,
              label: `Remise caisse · ${posLabel} · ${row.report_date}`,
              note: movementNote,
              created_by_user_id: userId,
            });
          }
          db.prepare(
            `UPDATE treasury_register_reports
             SET status = 'validated',
                 validated_at = datetime('now'),
                 validated_by_user_id = @uid,
                 cash_book_movement_id = @mid,
                 notes_treasury = @ntr
             WHERE id = @rid`,
          ).run({
            rid: reportId,
            uid: userId,
            mid: movementId,
            ntr: parsed.data.notesTreasury.trim(),
          });
        });
        run();
      } catch (e) {
        console.error(e);
        res.status(500).json({ code: "validate_failed" });
        return;
      }

      const updated = db.prepare(`${TREASURY_REPORT_SELECT} WHERE r.id = ?`).get(reportId) as ReportDbRow;
      res.status(200).json({ report: treasuryReportToPublic(updated) });
    },
  );

  r.post(
    "/reception-register-reports",
    requireAuth,
    requireAnyPermission(...RECEPTION_REGISTER_PERMS),
    (req: AuthedRequest, res: Response) => {
      const parsed = upsertReceptionReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const { reportDate, openingFloatUsd, countedCashUsd, notesCashier } = parsed.data;

      const userId = req.auth?.sub ?? null;
      if (!userId) {
        res.status(401).json({ code: "unauthorized" });
        return;
      }

      const role = req.auth?.role ?? "";
      if (!requireCashDayOpenForRole(role, reportDate, res)) return;

      const existing = db
        .prepare(
          `SELECT status FROM reception_register_reports WHERE report_date = ? AND report_owner_user_id = ?`,
        )
        .get(reportDate, userId) as { status: string | null } | undefined;
      if (existing?.status === "validated") {
        res.status(409).json({ code: "report_already_validated" });
        return;
      }

      const dayRecOpening = db
        .prepare(
          `SELECT reception_opening_float_usd FROM treasury_cash_day_openings WHERE business_date = ?`,
        )
        .get(reportDate) as { reception_opening_float_usd: number } | undefined;
      const effectiveOpeningFloatUsd = dayRecOpening
        ? dayRecOpening.reception_opening_float_usd
        : openingFloatUsd;

      const id = randomUUID();

      try {
        db.prepare(
          `INSERT INTO reception_register_reports
           (id, report_date, report_owner_user_id, opening_float_usd, counted_cash_usd, notes_cashier, submitted_by_user_id, status, notes_treasury)
           VALUES (@id, @report_date, @report_owner_user_id, @opening_float_usd, @counted_cash_usd, @notes_cashier, @submitted_by_user_id, 'submitted', '')
           ON CONFLICT(report_date, report_owner_user_id) DO UPDATE SET
             opening_float_usd = excluded.opening_float_usd,
             counted_cash_usd = excluded.counted_cash_usd,
             notes_cashier = excluded.notes_cashier,
             submitted_by_user_id = excluded.submitted_by_user_id,
             submitted_at = datetime('now'),
             status = 'submitted',
             validated_at = NULL,
             validated_by_user_id = NULL,
             cash_book_movement_id = NULL,
             notes_treasury = ''`,
        ).run({
          id,
          report_date: reportDate,
          report_owner_user_id: userId,
          opening_float_usd: effectiveOpeningFloatUsd,
          counted_cash_usd: countedCashUsd,
          notes_cashier: notesCashier.trim(),
          submitted_by_user_id: userId,
        });
      } catch (e) {
        console.error(e);
        res.status(500).json({ code: "insert_failed" });
        return;
      }

      const row = db
        .prepare(`${RECEPTION_REPORT_SELECT} WHERE r.report_date = ? AND r.report_owner_user_id = ?`)
        .get(reportDate, userId) as ReceptionReportDbRow;

      res.status(201).json({ report: receptionReportToPublic(row) });
    },
  );

  r.post(
    "/reception-register-reports/:reportId/validate",
    requireAuth,
    requireAnyPermission(...TREASURY_MANAGE_PERMS),
    (req: AuthedRequest, res: Response) => {
      const reportId = typeof req.params.reportId === "string" ? req.params.reportId.trim() : "";
      if (!reportId) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const parsed = validateReceptionReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }

      const row = db.prepare(`${RECEPTION_REPORT_SELECT} WHERE r.id = ?`).get(reportId) as ReceptionReportDbRow | undefined;
      if (!row) {
        res.status(404).json({ code: "not_found" });
        return;
      }
      if (row.status === "validated") {
        res.status(409).json({ code: "already_validated" });
        return;
      }

      const amountUsd =
        parsed.data.amountUsd !== undefined ? parsed.data.amountUsd : row.counted_cash_usd;

      let targetId: string | null = null;
      if (amountUsd > 0) {
        const tid = parsed.data.targetAccountId?.trim() || getDefaultRemittanceAccountId("USD");
        if (!tid) {
          res.status(400).json({ code: "no_cash_account" });
          return;
        }
        if (!getPhysicalCashAccount(tid, "USD")) {
          res.status(400).json({ code: "unknown_account" });
          return;
        }
        targetId = tid;
      }
      const userId = req.auth?.sub ?? null;
      const noteParts = [
        `Rapport caisse réception USD · ${row.report_date}.`,
        `Compté ${row.counted_cash_usd} USD, fond ${row.opening_float_usd} USD.`,
        row.notes_cashier ? `Caissier : ${row.notes_cashier}` : "",
        parsed.data.notesTreasury.trim() ? `Trésorerie : ${parsed.data.notesTreasury.trim()}` : "",
      ];
      const movementNote = noteParts.filter(Boolean).join(" ");

      try {
        const run = db.transaction(() => {
          let movementId: string | null = null;
          if (amountUsd > 0) {
            movementId = randomUUID();
            db.prepare(
              `INSERT INTO finance_cash_movements
               (id, category, occurred_at, source_account_id, target_account_id, amount, currency, label, note, created_by_user_id)
               VALUES (@id, 'adjustment_in', @occurred_at, NULL, @target_account_id, @amount, 'USD', @label, @note, @created_by_user_id)`,
            ).run({
              id: movementId,
              occurred_at: `${row.report_date}T12:00:00`,
              target_account_id: targetId!,
              amount: amountUsd,
              label: `Remise caisse réception · ${row.report_date}`,
              note: movementNote,
              created_by_user_id: userId,
            });
          }
          db.prepare(
            `UPDATE reception_register_reports
             SET status = 'validated',
                 validated_at = datetime('now'),
                 validated_by_user_id = @uid,
                 cash_book_movement_id = @mid,
                 notes_treasury = @ntr
             WHERE id = @rid`,
          ).run({
            rid: reportId,
            uid: userId,
            mid: movementId,
            ntr: parsed.data.notesTreasury.trim(),
          });
        });
        run();
      } catch (e) {
        console.error(e);
        res.status(500).json({ code: "validate_failed" });
        return;
      }

      const updated = db.prepare(`${RECEPTION_REPORT_SELECT} WHERE r.id = ?`).get(reportId) as ReceptionReportDbRow;
      res.status(200).json({ report: receptionReportToPublic(updated) });
    },
  );

  r.get("/points-of-sale", requireAuth, requireAnyPermission(...TREASURY_MANAGE_PERMS), (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.code, p.label, p.sort_order, p.is_main, p.active,
                p.stock_location_id, l.label AS stock_location_label
         FROM stock_points_of_sale p
         JOIN stock_locations l ON l.id = p.stock_location_id
         ORDER BY p.sort_order ASC, p.code COLLATE NOCASE ASC`,
      )
      .all() as PosManageRow[];
    res.json({ pointsOfSale: rows.map(rowToTreasuryManagePublic) });
  });

  r.post(
    "/points-of-sale",
    requireAuth,
    requireAnyPermission(...TREASURY_MANAGE_PERMS),
    (req: AuthedRequest, res: Response) => {
      const parsed = createPointOfSaleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const code = parsed.data.code;
      const label = parsed.data.label;
      if (codeTakenElsewhere(code)) {
        res.status(409).json({ code: "code_exists" });
        return;
      }

      const maxPos =
        (db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM stock_points_of_sale`).get() as { m: number }).m ??
        -1;
      const maxLoc =
        (db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM stock_locations`).get() as { m: number }).m ?? -1;
      const sortOrder = parsed.data.sortOrder ?? maxPos + 1;
      const locSort = Math.max(maxLoc + 1, sortOrder);

      const locationId = randomUUID();
      const posId = randomUUID();

      try {
        const run = db.transaction(() => {
          if (parsed.data.isMain) {
            clearAllMainFlags();
          }
          db.prepare(
            `INSERT INTO stock_locations (id, code, label, kind, sort_order, active)
             VALUES (@id, @code, @label, 'consumption', @sort_order, 1)`,
          ).run({
            id: locationId,
            code,
            label,
            sort_order: locSort,
          });
          db.prepare(
            `INSERT INTO stock_points_of_sale (id, code, label, sort_order, is_main, stock_location_id, active)
             VALUES (@id, @code, @label, @sort_order, @is_main, @stock_location_id, 1)`,
          ).run({
            id: posId,
            code,
            label,
            sort_order: sortOrder,
            is_main: parsed.data.isMain ? 1 : 0,
            stock_location_id: locationId,
          });
          if (!parsed.data.isMain) {
            ensureOneActiveMain();
          }
        });
        run();
      } catch (e) {
        console.error(e);
        res.status(500).json({ code: "insert_failed" });
        return;
      }

      const row = db
        .prepare(
          `SELECT p.id, p.code, p.label, p.sort_order, p.is_main, p.active,
                  p.stock_location_id, l.label AS stock_location_label
           FROM stock_points_of_sale p
           JOIN stock_locations l ON l.id = p.stock_location_id
           WHERE p.id = ?`,
        )
        .get(posId) as PosManageRow;
      res.status(201).json({ pointOfSale: rowToTreasuryManagePublic(row) });
    },
  );

  r.patch(
    "/points-of-sale/:id",
    requireAuth,
    requireAnyPermission(...TREASURY_MANAGE_PERMS),
    (req: Request, res: Response) => {
      const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
      if (!id) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const parsed = patchPointOfSaleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }

      const existing = db
        .prepare(
          `SELECT p.id, p.code, p.label, p.sort_order, p.is_main, p.active,
                  p.stock_location_id, l.label AS stock_location_label
           FROM stock_points_of_sale p
           JOIN stock_locations l ON l.id = p.stock_location_id
           WHERE p.id = ?`,
        )
        .get(id) as PosManageRow | undefined;
      if (!existing) {
        res.status(404).json({ code: "not_found" });
        return;
      }

      const nextCode = parsed.data.code ?? existing.code;
      const nextLabel = parsed.data.label ?? existing.label;
      const nextSort = parsed.data.sortOrder ?? existing.sort_order;
      let nextActive = parsed.data.active !== undefined ? (parsed.data.active ? 1 : 0) : existing.active;
      let nextMain = parsed.data.isMain !== undefined ? (parsed.data.isMain ? 1 : 0) : existing.is_main;

      if (nextCode !== existing.code && codeTakenElsewhere(nextCode, existing.id, existing.stock_location_id)) {
        res.status(409).json({ code: "code_exists" });
        return;
      }

      const activeCount = (
        db.prepare(`SELECT COUNT(*) AS c FROM stock_points_of_sale WHERE active = 1`).get() as { c: number }
      ).c;
      if (existing.active === 1 && nextActive === 0 && activeCount <= 1) {
        res.status(400).json({ code: "cannot_deactivate_last" });
        return;
      }

      try {
        const run = db.transaction(() => {
          if (parsed.data.isMain === true) {
            clearAllMainFlags();
            nextMain = 1;
          }
          if (nextActive === 0) {
            nextMain = 0;
          }
          db.prepare(
            `UPDATE stock_locations SET code = @code, label = @label WHERE id = @id`,
          ).run({ id: existing.stock_location_id, code: nextCode, label: nextLabel });
          db.prepare(
            `UPDATE stock_points_of_sale
             SET code = @code, label = @label, sort_order = @sort_order, active = @active, is_main = @is_main
             WHERE id = @id`,
          ).run({
            id,
            code: nextCode,
            label: nextLabel,
            sort_order: nextSort,
            active: nextActive,
            is_main: nextMain,
          });
          ensureOneActiveMain();
        });
        run();
      } catch (e) {
        console.error(e);
        res.status(500).json({ code: "update_failed" });
        return;
      }

      const row = db
        .prepare(
          `SELECT p.id, p.code, p.label, p.sort_order, p.is_main, p.active,
                  p.stock_location_id, l.label AS stock_location_label
           FROM stock_points_of_sale p
           JOIN stock_locations l ON l.id = p.stock_location_id
           WHERE p.id = ?`,
        )
        .get(id) as PosManageRow;
      res.json({ pointOfSale: rowToTreasuryManagePublic(row) });
    },
  );

  return r;
}
