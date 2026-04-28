import { randomUUID } from "node:crypto";
import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { roleSeesAllCashRegisterData } from "../cashRegisterScope.js";
import { localBusinessDateNow, requireCashDayOpenForRole } from "../cashDayOpen.js";
import { recordAudit } from "../auditLog.js";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import {
  reservationGrandTotal,
  reservationPaymentCoversConfirmation,
  statusAllowsAutoConfirmAfterPayment,
} from "../reservationPayment.js";
import { syncBungalowsForReservation } from "../syncBungalowStatus.js";
import { nominalToUsdEquivalent, parsePaymentCurrency, type PaymentCurrency } from "../paymentFx.js";

const methodEnum = z.enum(["Espèces", "Carte", "Virement", "Autre"]);

const createPaymentSchema = z.object({
  reservationId: z.string().min(1).max(80),
  amount: z.number().int().min(1).max(99_999_999),
  currency: z.enum(["USD", "CDF"]).optional().default("USD"),
  method: methodEnum.optional().default("Espèces"),
  note: z.string().max(500).optional().default(""),
});

type PaymentRow = {
  id: string;
  reservation_id: string;
  amount: number;
  currency: string;
  amount_usd_equivalent: number;
  method: string;
  note: string;
  created_at: string;
  received_by_user_id: string | null;
};

type JoinedPaymentRow = PaymentRow & {
  client_name: string;
  bungalow_code: string;
  stay_start: string;
  stay_end: string;
  reservation_total: number;
  reservation_status: string;
};

function rowToPublic(row: JoinedPaymentRow, balanceAfterThisPayment: number) {
  const cur = row.currency === "CDF" ? "CDF" : "USD";
  const usdEq = row.amount_usd_equivalent;
  return {
    id: row.id,
    reservationId: row.reservation_id,
    amount: row.amount,
    currency: cur,
    amountUsdEquivalent: usdEq,
    method: row.method,
    note: row.note,
    createdAt: row.created_at,
    clientName: row.client_name,
    bungalowCode: row.bungalow_code,
    stayStart: row.stay_start,
    stayEnd: row.stay_end,
    reservationTotal: row.reservation_total,
    reservationStatus: row.reservation_status,
    reservationAmountPaid: balanceAfterThisPayment,
  };
}

/** Cumul encaissé sur la réservation après chaque ligne (ordre chronologique). */
function withRunningBalances(rows: JoinedPaymentRow[]): { row: JoinedPaymentRow; balance: number }[] {
  const asc = [...rows].sort((a, b) => {
    const t = a.created_at.localeCompare(b.created_at);
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
  const perRes = new Map<string, number>();
  const out: { row: JoinedPaymentRow; balance: number }[] = [];
  for (const row of asc) {
    const prev = perRes.get(row.reservation_id) ?? 0;
    const next = prev + row.amount_usd_equivalent;
    perRes.set(row.reservation_id, next);
    out.push({ row, balance: next });
  }
  return out;
}

const encashReservationActors = requireAnyPermission(
  "finance.payments",
  "lodging.reservations",
  "lodging.stay_reception",
  "lodging.reception_cash",
);

export function paymentRoutes(): Router {
  const r = createRouter();

  r.get("/", requireAuth, encashReservationActors, (req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.reservation_id, p.amount,
                COALESCE(p.currency, 'USD') AS currency,
                COALESCE(p.amount_usd_equivalent, p.amount) AS amount_usd_equivalent,
                p.method, p.note, p.created_at, p.received_by_user_id,
                c.name AS client_name,
                b.code AS bungalow_code,
                r.start_date AS stay_start,
                r.end_date AS stay_end,
                r.amount AS reservation_total,
                r.status AS reservation_status
         FROM reservation_payments p
         JOIN reservations r ON r.id = p.reservation_id
         JOIN clients c ON c.id = r.client_id
         JOIN bungalows b ON b.id = r.bungalow_id`,
      )
      .all() as JoinedPaymentRow[];
    const role = req.auth?.role ?? "";
    const userId = req.auth?.sub ?? "";
    const globalView = roleSeesAllCashRegisterData(role);
    const filtered = globalView
      ? rows
      : rows.filter((x) => x.received_by_user_id != null && x.received_by_user_id === userId);
    const balanced = withRunningBalances(filtered);
    const desc = [...balanced].sort((a, b) => {
      const t = b.row.created_at.localeCompare(a.row.created_at);
      if (t !== 0) return t;
      return b.row.id.localeCompare(a.row.id);
    });
    res.json({ payments: desc.map(({ row, balance }) => rowToPublic(row, balance)) });
  });

  r.post("/", requireAuth, encashReservationActors, (req: AuthedRequest, res: Response) => {
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const { reservationId, amount: nominal, method, note } = parsed.data;
    const currency: PaymentCurrency = parsePaymentCurrency(parsed.data.currency);
    const amountUsdEq = nominalToUsdEquivalent(nominal, currency);
    if (currency === "CDF" && amountUsdEq < 1) {
      res.status(400).json({ code: "cdf_amount_too_small" });
      return;
    }

    const row = db
      .prepare(
        `SELECT id, bungalow_id, status, amount, COALESCE(amount_paid, 0) AS amount_paid,
                COALESCE(late_penalty_usd, 0) AS late_penalty_usd
         FROM reservations WHERE id = ?`,
      )
      .get(reservationId) as
      | {
          id: string;
          bungalow_id: string;
          status: string;
          amount: number;
          amount_paid: number;
          late_penalty_usd: number;
        }
      | undefined;
    if (!row) {
      res.status(400).json({ code: "unknown_reservation" });
      return;
    }

    const totalDue = reservationGrandTotal(row.amount, row.late_penalty_usd ?? 0);
    const reste = Math.max(0, totalDue - row.amount_paid);
    if (reste <= 0) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    if (amountUsdEq > reste) {
      res.status(400).json({ code: "amount_exceeds_balance" });
      return;
    }

    const role = req.auth?.role ?? "";
    if (!requireCashDayOpenForRole(role, localBusinessDateNow(), res)) return;

    const nextPaid = row.amount_paid + amountUsdEq;
    let nextStatus = row.status;
    if (
      statusAllowsAutoConfirmAfterPayment(row.status) &&
      reservationPaymentCoversConfirmation(row.amount, row.late_penalty_usd ?? 0, nextPaid)
    ) {
      nextStatus = "Confirmé";
    }

    const id = randomUUID();
    try {
      const run = db.transaction(() => {
        db.prepare(
          `INSERT INTO reservation_payments (id, reservation_id, amount, currency, amount_usd_equivalent, method, note, received_by_user_id, created_at)
           VALUES (@id, @reservation_id, @amount, @currency, @amount_usd_equivalent, @method, @note, @received_by_user_id, datetime('now'))`,
        ).run({
          id,
          reservation_id: reservationId,
          amount: nominal,
          currency,
          amount_usd_equivalent: amountUsdEq,
          method,
          note: note ?? "",
          received_by_user_id: req.auth?.sub ?? null,
        });
        db.prepare(
          `UPDATE reservations SET amount_paid = @amount_paid, status = @status, updated_at = datetime('now') WHERE id = @id`,
        ).run({
          id: reservationId,
          amount_paid: nextPaid,
          status: nextStatus,
        });
        syncBungalowsForReservation(reservationId);
      });
      run();
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "server_error" });
      return;
    }

    const joined = db
      .prepare(
        `SELECT p.id, p.reservation_id, p.amount,
                COALESCE(p.currency, 'USD') AS currency,
                COALESCE(p.amount_usd_equivalent, p.amount) AS amount_usd_equivalent,
                p.method, p.note, p.created_at, p.received_by_user_id,
                c.name AS client_name,
                b.code AS bungalow_code,
                r.start_date AS stay_start,
                r.end_date AS stay_end,
                r.amount AS reservation_total,
                r.status AS reservation_status
         FROM reservation_payments p
         JOIN reservations r ON r.id = p.reservation_id
         JOIN clients c ON c.id = r.client_id
         JOIN bungalows b ON b.id = r.bungalow_id
         WHERE p.id = ?`,
      )
      .get(id) as JoinedPaymentRow | undefined;

    const paymentPublic = joined ? rowToPublic(joined, nextPaid) : null;

    const auditAmt =
      currency === "CDF" ? `${nominal.toLocaleString("fr-FR")} FC (equiv. ${amountUsdEq} USD)` : `${nominal} USD`;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "create",
      entityType: "reservation_payment",
      entityId: id,
      summary: `Encaissement réservation ${reservationId} : ${auditAmt} (${method})`,
    });

    res.status(201).json({
      payment: paymentPublic,
      reservation: {
        id: reservationId,
        amountPaid: nextPaid,
        status: nextStatus,
      },
    });
  });

  return r;
}
