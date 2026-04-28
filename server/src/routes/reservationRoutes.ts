import { randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { recordAudit } from "../auditLog.js";
import { db } from "../db.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { LODGING_MODULE_CODES } from "../permissionCodes.js";
import {
  reservationPaymentCoversConfirmation,
  statusAllowsAutoConfirmAfterPayment,
} from "../reservationPayment.js";
import { markBungalowsHousekeepingDirty } from "../housekeeping.js";
import { syncBungalowsForReservation } from "../syncBungalowStatus.js";

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const statusEnum = z.enum(["En attente paiement", "Confirmé", "En cours", "Terminé", "No-show"]);
const reservationKindEnum = z.enum(["individual", "group"]);
const bookingChannelEnum = z.enum(["direct", "ota", "telephone", "agence", "autre"]);

const patchReservationSchema = z
  .object({
    status: statusEnum.optional(),
    guestCount: z.coerce.number().int().min(2).max(99).optional(),
    bookingChannel: bookingChannelEnum.optional(),
  })
  .refine((d) => d.status !== undefined || d.guestCount !== undefined || d.bookingChannel !== undefined, {
    message: "empty_patch",
  });

const patchPaymentSchema = z.object({
  amountPaid: z.number().int().min(0).max(99_999_999),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date_iso");

const patchStaySchema = z.object({
  end: isoDate,
  amount: z.number().int().min(0).max(99_999_999),
});

const createReservationSchema = z
  .object({
    clientId: z.string().min(1).max(80),
    bungalowIds: z.array(z.string().min(1).max(80)).min(1).max(30),
    start: isoDate,
    end: isoDate,
    amount: z.number().int().min(0).max(99_999_999),
    reservationKind: reservationKindEnum,
    guestCount: z.coerce.number().int().min(2).max(99).optional(),
    bookingChannel: bookingChannelEnum.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.end <= data.start) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "end_after_start", path: ["end"] });
    }
    if (new Set(data.bungalowIds).size !== data.bungalowIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_bungalow", path: ["bungalowIds"] });
    }
    if (data.reservationKind === "individual") {
      if (data.bungalowIds.length !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "individual_single_bungalow", path: ["bungalowIds"] });
      }
    } else {
      if (data.bungalowIds.length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "group_min_bungalows", path: ["bungalowIds"] });
      }
      if (data.guestCount == null || data.guestCount < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "group_guest_required", path: ["guestCount"] });
      }
    }
  });

type ReservationRow = {
  id: string;
  client_id: string;
  bungalow_id: string;
  start_date: string;
  end_date: string;
  status: string;
  amount: number;
  amount_paid: number;
  late_penalty_usd: number;
  guest_count: number;
  reservation_kind: string;
  booking_channel: string;
  created_at?: string | null;
  updated_at?: string | null;
};

const RESERVATION_LIST_SELECT = `id, client_id, bungalow_id, start_date, end_date, status, amount,
                COALESCE(amount_paid, 0) AS amount_paid,
                COALESCE(late_penalty_usd, 0) AS late_penalty_usd,
                COALESCE(guest_count, 1) AS guest_count,
                COALESCE(reservation_kind, 'individual') AS reservation_kind,
                COALESCE(booking_channel, 'direct') AS booking_channel,
                created_at, updated_at`;

function loadBungalowIdsForReservation(reservationId: string, fallbackBungalowId: string): string[] {
  const rows = db
    .prepare(
      `SELECT bungalow_id FROM reservation_bungalows WHERE reservation_id = ? ORDER BY sort_order ASC, bungalow_id ASC`,
    )
    .all(reservationId) as { bungalow_id: string }[];
  if (rows.length) return rows.map((r) => r.bungalow_id);
  return [fallbackBungalowId];
}

function rowToPublic(row: ReservationRow) {
  const bungalowIds = loadBungalowIdsForReservation(row.id, row.bungalow_id);
  const kind = row.reservation_kind === "group" ? "group" : "individual";
  const guestCount =
    kind === "group" ? Math.max(2, Math.min(99, Math.floor(Number(row.guest_count ?? 2)))) : 1;
  return {
    id: row.id,
    clientId: row.client_id,
    bungalowId: bungalowIds[0] ?? row.bungalow_id,
    bungalowIds,
    reservationKind: kind,
    start: row.start_date,
    end: row.end_date,
    status: row.status,
    amount: row.amount,
    amountPaid: row.amount_paid ?? 0,
    latePenaltyUsd: row.late_penalty_usd ?? 0,
    guestCount,
    bookingChannel: row.booking_channel ?? "direct",
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? row.created_at ?? "",
  };
}

function getReservationRow(id: string): ReservationRow | undefined {
   return db
    .prepare(
      `SELECT id, client_id, bungalow_id, start_date, end_date, status, amount,
              COALESCE(amount_paid, 0) AS amount_paid,
              COALESCE(late_penalty_usd, 0) AS late_penalty_usd,
              COALESCE(guest_count, 1) AS guest_count,
              COALESCE(reservation_kind, 'individual') AS reservation_kind,
              COALESCE(booking_channel, 'direct') AS booking_channel,
              created_at, updated_at
       FROM reservations WHERE id = ?`,
    )
    .get(id) as ReservationRow | undefined;
}

function paramId(req: Request): string {
  const raw = req.params.id;
  return typeof raw === "string" ? raw : raw[0] ?? "";
}

/** Chevauchement sur [start, end) pour un bungalow (réservation principale ou table de liaison). */
function bungalowHasOverlap(bungalowId: string, start: string, end: string, excludeId?: string): boolean {
  const row = db
    .prepare(
      `SELECT r.id FROM reservations r
       WHERE r.start_date < @end AND r.end_date > @start
         AND (
           r.bungalow_id = @bungalowId
           OR EXISTS (
             SELECT 1 FROM reservation_bungalows rb
             WHERE rb.reservation_id = r.id AND rb.bungalow_id = @bungalowId
           )
         )
         ${excludeId ? "AND r.id != @excludeId" : ""}
       LIMIT 1`,
    )
    .get(
      excludeId ? { bungalowId, start, end, excludeId } : { bungalowId, start, end },
    ) as { id: string } | undefined;
  return Boolean(row);
}

export function reservationRoutes(): Router {
  const r = createRouter();

  const extendableStayStatuses = new Set(["Confirmé", "En cours", "Terminé"]);

  r.get("/", requireAuth, requireAnyPermission(...LODGING_MODULE_CODES), (_req: Request, res: Response) => {
    const rows = db.prepare(`SELECT ${RESERVATION_LIST_SELECT} FROM reservations ORDER BY start_date ASC, id ASC`).all() as ReservationRow[];
    res.json({ reservations: rows.map(rowToPublic) });
  });

  r.post("/", requireAuth, requireAnyPermission("lodging.reservations"), (req: AuthedRequest, res: Response) => {
    const parsed = createReservationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const { clientId, bungalowIds, start, end, amount, reservationKind, guestCount: gcIn, bookingChannel } =
      parsed.data;
    const bookingChannelStored = bookingChannel ?? "direct";
    const guestCountStored = reservationKind === "individual" ? 1 : Math.max(2, Math.min(99, gcIn ?? 2));
    const primaryBungalowId = bungalowIds[0]!;

    const clientOk = db.prepare("SELECT 1 AS x FROM clients WHERE id = ?").get(clientId) as { x: number } | undefined;
    if (!clientOk) {
      res.status(400).json({ code: "unknown_client" });
      return;
    }

    for (const bid of bungalowIds) {
      const bungalowRow = db.prepare("SELECT status FROM bungalows WHERE id = ?").get(bid) as
        | { status: string }
        | undefined;
      if (!bungalowRow) {
        res.status(400).json({ code: "unknown_bungalow" });
        return;
      }
      if (bungalowRow.status !== "Disponible") {
        res.status(400).json({ code: "bungalow_not_available" });
        return;
      }
      if (bungalowHasOverlap(bid, start, end)) {
        res.status(409).json({ code: "bungalow_overlap" });
        return;
      }
    }

    const id = randomUUID();
    const status = "En attente paiement";
    const amount_paid = 0;
    const insRes = db.prepare(
      `INSERT INTO reservations (id, client_id, bungalow_id, start_date, end_date, status, amount, amount_paid, guest_count, reservation_kind, booking_channel, created_at, updated_at)
       VALUES (@id, @client_id, @bungalow_id, @start_date, @end_date, @status, @amount, @amount_paid, @guest_count, @reservation_kind, @booking_channel, datetime('now'), datetime('now'))`,
    );
    const insRb = db.prepare(
      `INSERT INTO reservation_bungalows (reservation_id, bungalow_id, sort_order) VALUES (@reservation_id, @bungalow_id, @sort_order)`,
    );

    try {
      const run = db.transaction(() => {
        insRes.run({
          id,
          client_id: clientId,
          bungalow_id: primaryBungalowId,
          start_date: start,
          end_date: end,
          status,
          amount,
          amount_paid,
          guest_count: guestCountStored,
          reservation_kind: reservationKind,
          booking_channel: bookingChannelStored,
        });
        bungalowIds.forEach((bid, i) => {
          insRb.run({ reservation_id: id, bungalow_id: bid, sort_order: i });
        });
      });
      run();
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "server_error" });
      return;
    }

    const row = getReservationRow(id)!;
    syncBungalowsForReservation(id);
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "create",
      entityType: "reservation",
      entityId: id,
      summary: `Réservation créée : ${start} → ${end} — ${amount} USD`,
    });
    res.status(201).json({ reservation: rowToPublic(row) });
  });

  r.patch("/:id/payment", requireAuth, requireAnyPermission("lodging.reservations"), (req: AuthedRequest, res: Response) => {
    const parsed = patchPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const id = paramId(req);
    const row = getReservationRow(id);
    if (!row) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const amountPaid = parsed.data.amountPaid;
    let nextStatus = row.status;
    if (
      statusAllowsAutoConfirmAfterPayment(row.status) &&
      reservationPaymentCoversConfirmation(row.amount, row.late_penalty_usd ?? 0, amountPaid)
    ) {
      nextStatus = "Confirmé";
    }
    db.prepare(
      `UPDATE reservations SET amount_paid = @amountPaid, status = @status, updated_at = datetime('now') WHERE id = @id`,
    ).run({ id, amountPaid, status: nextStatus });

    syncBungalowsForReservation(id);
    const updated = getReservationRow(id)!;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "reservation",
      entityId: id,
      summary: `Paiement réservation : +${amountPaid - row.amount_paid} USD (solde ${amountPaid}) — statut ${nextStatus}`,
    });
    res.json({ reservation: rowToPublic(updated) });
  });

  r.post(
    "/:id/occupancy-penalty",
    requireAuth,
    requireAnyPermission("lodging.reservations"),
    (req: AuthedRequest, res: Response) => {
    const id = paramId(req);
    const row = getReservationRow(id);
    if (!row) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const rules = db
      .prepare("SELECT grace_days, penalty_usd FROM app_occupancy_rules WHERE id = 1")
      .get() as { grace_days: number; penalty_usd: number } | undefined;
    if (!rules) {
      res.status(500).json({ code: "occupancy_not_configured" });
      return;
    }
    if ((row.late_penalty_usd ?? 0) > 0) {
      res.status(400).json({ code: "penalty_already_applied" });
      return;
    }
    if (row.status !== "Confirmé") {
      res.status(400).json({ code: "not_eligible_status" });
      return;
    }
    if (rules.penalty_usd <= 0) {
      res.status(400).json({ code: "penalty_amount_zero" });
      return;
    }
    const today = todayIsoUtc();
    const deadline = addDaysIso(row.start_date, rules.grace_days);
    if (today < deadline) {
      res.status(400).json({ code: "grace_not_expired" });
      return;
    }
    db.prepare("UPDATE reservations SET late_penalty_usd = @penalty, updated_at = datetime('now') WHERE id = @id").run({
      id,
      penalty: rules.penalty_usd,
    });
    syncBungalowsForReservation(id);
    const updated = getReservationRow(id)!;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "reservation",
      entityId: id,
      summary: `Pénalité occupation : +${rules.penalty_usd} USD`,
    });
    res.json({ reservation: rowToPublic(updated) });
  });

  r.patch("/:id/stay", requireAuth, requireAnyPermission("lodging.reservations"), (req: AuthedRequest, res: Response) => {
    const parsed = patchStaySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const id = paramId(req);
    const row = getReservationRow(id);
    if (!row) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    if (!extendableStayStatuses.has(row.status)) {
      res.status(400).json({ code: "not_extendable_status" });
      return;
    }
    const { end: newEnd, amount: newAmount } = parsed.data;
    if (newEnd <= row.end_date) {
      res.status(400).json({ code: "end_not_after_current" });
      return;
    }
    if (newEnd <= row.start_date) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const unitIds = loadBungalowIdsForReservation(row.id, row.bungalow_id);
    for (const bid of unitIds) {
      if (bungalowHasOverlap(bid, row.start_date, newEnd, row.id)) {
        res.status(409).json({ code: "bungalow_overlap" });
        return;
      }
    }

    const today = todayIsoUtc();
    const prevStayStatus = row.status;
    let nextStatus = row.status;
    if (row.start_date <= today && today < newEnd) {
      if (row.status === "Terminé") nextStatus = "En cours";
    } else if (row.start_date <= today && today >= newEnd && row.status === "En cours") {
      nextStatus = "Terminé";
    }

    db.prepare(
      `UPDATE reservations SET end_date = @end_date, amount = @amount, status = @status, updated_at = datetime('now') WHERE id = @id`,
    ).run({
      id,
      end_date: newEnd,
      amount: newAmount,
      status: nextStatus,
    });
    syncBungalowsForReservation(id);
    if (nextStatus === "Terminé" && prevStayStatus !== "Terminé") {
      markBungalowsHousekeepingDirty(loadBungalowIdsForReservation(row.id, row.bungalow_id));
    }
    const updated = getReservationRow(id)!;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "reservation",
      entityId: id,
      summary: `Séjour modifié : fin ${newEnd}, montant ${newAmount} USD`,
    });
    res.json({ reservation: rowToPublic(updated) });
  });

  r.patch("/:id", requireAuth, requireAnyPermission("lodging.reservations"), (req: AuthedRequest, res: Response) => {
    const parsed = patchReservationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const id = paramId(req);
    const row = getReservationRow(id);
    if (!row) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const { status: nextStatus, guestCount: nextGuest, bookingChannel: nextChannel } = parsed.data;
    if (
      nextStatus === "Confirmé" &&
      !reservationPaymentCoversConfirmation(row.amount, row.late_penalty_usd ?? 0, row.amount_paid ?? 0)
    ) {
      res.status(400).json({ code: "confirm_requires_payment" });
      return;
    }
    if (nextGuest !== undefined && row.reservation_kind !== "group") {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const sets: string[] = [];
    const params: Record<string, string | number> = { id };
    if (nextGuest !== undefined) {
      sets.push("guest_count = @guest_count");
      params.guest_count = nextGuest;
    }
    if (nextStatus !== undefined) {
      sets.push("status = @status");
      params.status = nextStatus;
    }
    if (nextChannel !== undefined) {
      sets.push("booking_channel = @booking_channel");
      params.booking_channel = nextChannel;
    }
    if (sets.length === 0) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    sets.push("updated_at = datetime('now')");
    const prevStatus = row.status;
    db.prepare(`UPDATE reservations SET ${sets.join(", ")} WHERE id = @id`).run(params);
    syncBungalowsForReservation(id);
    if (nextStatus === "Terminé" && prevStatus !== "Terminé") {
      markBungalowsHousekeepingDirty(loadBungalowIdsForReservation(id, row.bungalow_id));
    }
    const updated = getReservationRow(id)!;
    const parts: string[] = [];
    if (nextStatus !== undefined) parts.push(`statut → ${nextStatus}`);
    if (nextGuest !== undefined) parts.push(`effectif ${nextGuest}`);
    if (nextChannel !== undefined) parts.push(`canal → ${nextChannel}`);
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "reservation",
      entityId: id,
      summary: `Réservation modifiée : ${parts.join(" ; ") || "mise à jour"}`,
    });
    res.json({ reservation: rowToPublic(updated) });
  });

  return r;
}
