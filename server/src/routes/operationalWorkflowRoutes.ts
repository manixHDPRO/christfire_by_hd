import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";

const eligibleReservationStatuses = new Set(["Confirmé", "En cours", "Terminé"]);

const isoDateTimeOrNull = z
  .union([z.string().min(1).max(40), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : v));

const patchOperationalWorkflowSchema = z.object({
  legalCountryCode: z
    .string()
    .length(2)
    .regex(/^[a-zA-Z]{2}$/)
    .transform((s) => s.toUpperCase())
    .optional(),
  idDocumentVerifiedAt: isoDateTimeOrNull,
  depositAmountUsd: z.number().int().min(0).max(999_999_999).optional(),
  depositMethod: z.string().max(120).optional(),
  depositReceivedAt: isoDateTimeOrNull,
  arrivalSignatureAt: isoDateTimeOrNull,
  arrivalInventoryNote: z.string().max(8000).optional(),
  arrivalInventoryOk: z.boolean().optional(),
  checkInCompletedAt: isoDateTimeOrNull,
  departureExtrasNote: z.string().max(4000).optional(),
  departureExtrasAmountUsd: z.number().int().min(0).max(999_999_999).optional(),
  keysReturned: z.boolean().optional(),
  keysNote: z.string().max(500).optional(),
  checkOutCompletedAt: isoDateTimeOrNull,
  legalDocumentsAckAt: isoDateTimeOrNull,
  legalAckDocIds: z.array(z.string().max(80)).max(50).optional(),
});

type WorkflowRow = {
  reservation_id: string;
  legal_country_code: string;
  id_document_verified_at: string | null;
  deposit_amount_usd: number;
  deposit_method: string;
  deposit_received_at: string | null;
  arrival_signature_at: string | null;
  arrival_inventory_note: string;
  arrival_inventory_ok: number;
  check_in_completed_at: string | null;
  departure_extras_note: string;
  departure_extras_amount_usd: number;
  keys_returned: number;
  keys_note: string;
  check_out_completed_at: string | null;
  legal_documents_ack_at: string | null;
  legal_ack_doc_ids_json: string;
  updated_at: string;
};

function parseDocIds(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function rowToPublic(row: WorkflowRow) {
  return {
    reservationId: row.reservation_id,
    legalCountryCode: row.legal_country_code,
    idDocumentVerifiedAt: row.id_document_verified_at,
    depositAmountUsd: row.deposit_amount_usd,
    depositMethod: row.deposit_method,
    depositReceivedAt: row.deposit_received_at,
    arrivalSignatureAt: row.arrival_signature_at,
    arrivalInventoryNote: row.arrival_inventory_note,
    arrivalInventoryOk: row.arrival_inventory_ok === 1,
    checkInCompletedAt: row.check_in_completed_at,
    departureExtrasNote: row.departure_extras_note,
    departureExtrasAmountUsd: row.departure_extras_amount_usd,
    keysReturned: row.keys_returned === 1,
    keysNote: row.keys_note,
    checkOutCompletedAt: row.check_out_completed_at,
    legalDocumentsAckAt: row.legal_documents_ack_at,
    legalAckDocIds: parseDocIds(row.legal_ack_doc_ids_json),
    updatedAt: row.updated_at,
  };
}

function defaultWorkflow(reservationId: string) {
  const row: WorkflowRow = {
    reservation_id: reservationId,
    legal_country_code: "CD",
    id_document_verified_at: null,
    deposit_amount_usd: 0,
    deposit_method: "",
    deposit_received_at: null,
    arrival_signature_at: null,
    arrival_inventory_note: "",
    arrival_inventory_ok: 0,
    check_in_completed_at: null,
    departure_extras_note: "",
    departure_extras_amount_usd: 0,
    keys_returned: 0,
    keys_note: "",
    check_out_completed_at: null,
    legal_documents_ack_at: null,
    legal_ack_doc_ids_json: "[]",
    updated_at: "",
  };
  return rowToPublic(row);
}

function getWorkflowRow(reservationId: string): WorkflowRow | undefined {
  return db
    .prepare(
      `SELECT reservation_id, legal_country_code, id_document_verified_at, deposit_amount_usd,
              deposit_method, deposit_received_at, arrival_signature_at, arrival_inventory_note,
              arrival_inventory_ok, check_in_completed_at, departure_extras_note,
              departure_extras_amount_usd, keys_returned, keys_note, check_out_completed_at,
              legal_documents_ack_at, legal_ack_doc_ids_json, updated_at
       FROM reservation_operational_workflow WHERE reservation_id = ?`,
    )
    .get(reservationId) as WorkflowRow | undefined;
}

function reservationSummary(reservationId: string):
  | {
      id: string;
      client_id: string;
      bungalow_id: string;
      start_date: string;
      end_date: string;
      status: string;
      client_name: string;
      bungalow_codes: string;
    }
  | undefined {
  return db
    .prepare(
      `SELECT r.id, r.client_id, r.bungalow_id, r.start_date, r.end_date, r.status,
              c.name AS client_name,
              COALESCE(
                (SELECT GROUP_CONCAT(b.code, ', ')
                 FROM reservation_bungalows rb
                 JOIN bungalows b ON b.id = rb.bungalow_id
                 WHERE rb.reservation_id = r.id),
                (SELECT code FROM bungalows WHERE id = r.bungalow_id),
                ''
              ) AS bungalow_codes
       FROM reservations r
       JOIN clients c ON c.id = r.client_id
       WHERE r.id = ?`,
    )
    .get(reservationId) as
    | {
        id: string;
        client_id: string;
        bungalow_id: string;
        start_date: string;
        end_date: string;
        status: string;
        client_name: string;
        bungalow_codes: string;
      }
    | undefined;
}

function paramReservationId(req: Request): string {
  const raw = req.params.reservationId;
  return typeof raw === "string" ? raw : raw[0] ?? "";
}

export function operationalWorkflowRoutes(): Router {
  const r = createRouter();

  r.get("/", requireAuth, requireAnyPermission("lodging.stay_reception"), (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT r.id AS reservation_id, r.client_id, r.start_date, r.end_date, r.status,
                c.name AS client_name,
                COALESCE(
                  (SELECT GROUP_CONCAT(b.code, ', ')
                   FROM reservation_bungalows rb
                   JOIN bungalows b ON b.id = rb.bungalow_id
                   WHERE rb.reservation_id = r.id),
                  (SELECT code FROM bungalows WHERE id = r.bungalow_id),
                  ''
                ) AS bungalow_codes,
                w.legal_country_code,
                w.id_document_verified_at,
                w.deposit_amount_usd,
                w.deposit_method,
                w.deposit_received_at,
                w.arrival_signature_at,
                w.arrival_inventory_note,
                w.arrival_inventory_ok,
                w.check_in_completed_at,
                w.departure_extras_note,
                w.departure_extras_amount_usd,
                w.keys_returned,
                w.keys_note,
                w.check_out_completed_at,
                w.legal_documents_ack_at,
                w.legal_ack_doc_ids_json,
                w.updated_at
         FROM reservations r
         JOIN clients c ON c.id = r.client_id
         LEFT JOIN reservation_operational_workflow w ON w.reservation_id = r.id
         WHERE r.status IN ('Confirmé', 'En cours', 'Terminé')
         ORDER BY r.start_date DESC, r.id DESC`,
      )
      .all() as {
      reservation_id: string;
      client_id: string;
      start_date: string;
      end_date: string;
      status: string;
      client_name: string;
      bungalow_codes: string;
      legal_country_code: string | null;
      id_document_verified_at: string | null;
      deposit_amount_usd: number | null;
      deposit_method: string | null;
      deposit_received_at: string | null;
      arrival_signature_at: string | null;
      arrival_inventory_note: string | null;
      arrival_inventory_ok: number | null;
      check_in_completed_at: string | null;
      departure_extras_note: string | null;
      departure_extras_amount_usd: number | null;
      keys_returned: number | null;
      keys_note: string | null;
      check_out_completed_at: string | null;
      legal_documents_ack_at: string | null;
      legal_ack_doc_ids_json: string | null;
      updated_at: string | null;
    }[];

    const items = rows.map((row) => {
      const hasWorkflow = row.legal_country_code != null;
      const wf = hasWorkflow
        ? rowToPublic({
            reservation_id: row.reservation_id,
            legal_country_code: row.legal_country_code!,
            id_document_verified_at: row.id_document_verified_at,
            deposit_amount_usd: row.deposit_amount_usd ?? 0,
            deposit_method: row.deposit_method ?? "",
            deposit_received_at: row.deposit_received_at,
            arrival_signature_at: row.arrival_signature_at,
            arrival_inventory_note: row.arrival_inventory_note ?? "",
            arrival_inventory_ok: row.arrival_inventory_ok ?? 0,
            check_in_completed_at: row.check_in_completed_at,
            departure_extras_note: row.departure_extras_note ?? "",
            departure_extras_amount_usd: row.departure_extras_amount_usd ?? 0,
            keys_returned: row.keys_returned ?? 0,
            keys_note: row.keys_note ?? "",
            check_out_completed_at: row.check_out_completed_at,
            legal_documents_ack_at: row.legal_documents_ack_at,
            legal_ack_doc_ids_json: row.legal_ack_doc_ids_json ?? "[]",
            updated_at: row.updated_at ?? "",
          })
        : defaultWorkflow(row.reservation_id);

      return {
        reservationId: row.reservation_id,
        clientId: row.client_id,
        clientName: row.client_name,
        bungalowCodes: row.bungalow_codes,
        start: row.start_date,
        end: row.end_date,
        status: row.status,
        workflow: wf,
        hasPersistedWorkflow: hasWorkflow,
      };
    });

    res.json({ items });
  });

  r.get("/:reservationId", requireAuth, requireAnyPermission("lodging.stay_reception"), (req: Request, res: Response) => {
    const reservationId = paramReservationId(req);
    const summary = reservationSummary(reservationId);
    if (!summary || !eligibleReservationStatuses.has(summary.status)) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const row = getWorkflowRow(reservationId);
    const workflow = row ? rowToPublic(row) : defaultWorkflow(reservationId);
    res.json({
      reservation: {
        id: summary.id,
        clientId: summary.client_id,
        clientName: summary.client_name,
        bungalowCodes: summary.bungalow_codes,
        start: summary.start_date,
        end: summary.end_date,
        status: summary.status,
      },
      workflow,
      hasPersistedWorkflow: Boolean(row),
    });
  });

  r.patch("/:reservationId", requireAuth, requireAnyPermission("lodging.stay_reception"), (req: Request, res: Response) => {
    const parsed = patchOperationalWorkflowSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const reservationId = paramReservationId(req);
    const summary = reservationSummary(reservationId);
    if (!summary || !eligibleReservationStatuses.has(summary.status)) {
      res.status(404).json({ code: "not_found" });
      return;
    }

    const existing = getWorkflowRow(reservationId);
    const base: WorkflowRow = existing ?? {
      reservation_id: reservationId,
      legal_country_code: "CD",
      id_document_verified_at: null,
      deposit_amount_usd: 0,
      deposit_method: "",
      deposit_received_at: null,
      arrival_signature_at: null,
      arrival_inventory_note: "",
      arrival_inventory_ok: 0,
      check_in_completed_at: null,
      departure_extras_note: "",
      departure_extras_amount_usd: 0,
      keys_returned: 0,
      keys_note: "",
      check_out_completed_at: null,
      legal_documents_ack_at: null,
      legal_ack_doc_ids_json: "[]",
      updated_at: "",
    };

    const p = parsed.data;
    if (p.legalCountryCode !== undefined) base.legal_country_code = p.legalCountryCode;
    if (p.idDocumentVerifiedAt !== undefined) base.id_document_verified_at = p.idDocumentVerifiedAt;
    if (p.depositAmountUsd !== undefined) base.deposit_amount_usd = p.depositAmountUsd;
    if (p.depositMethod !== undefined) base.deposit_method = p.depositMethod;
    if (p.depositReceivedAt !== undefined) base.deposit_received_at = p.depositReceivedAt;
    if (p.arrivalSignatureAt !== undefined) base.arrival_signature_at = p.arrivalSignatureAt;
    if (p.arrivalInventoryNote !== undefined) base.arrival_inventory_note = p.arrivalInventoryNote;
    if (p.arrivalInventoryOk !== undefined) base.arrival_inventory_ok = p.arrivalInventoryOk ? 1 : 0;
    if (p.checkInCompletedAt !== undefined) base.check_in_completed_at = p.checkInCompletedAt;
    if (p.departureExtrasNote !== undefined) base.departure_extras_note = p.departureExtrasNote;
    if (p.departureExtrasAmountUsd !== undefined)
      base.departure_extras_amount_usd = p.departureExtrasAmountUsd;
    if (p.keysReturned !== undefined) base.keys_returned = p.keysReturned ? 1 : 0;
    if (p.keysNote !== undefined) base.keys_note = p.keysNote;
    if (p.checkOutCompletedAt !== undefined) base.check_out_completed_at = p.checkOutCompletedAt;
    if (p.legalDocumentsAckAt !== undefined) base.legal_documents_ack_at = p.legalDocumentsAckAt;
    if (p.legalAckDocIds !== undefined)
      base.legal_ack_doc_ids_json = JSON.stringify(p.legalAckDocIds);

    db.prepare(
      `INSERT INTO reservation_operational_workflow (
        reservation_id, legal_country_code, id_document_verified_at, deposit_amount_usd,
        deposit_method, deposit_received_at, arrival_signature_at, arrival_inventory_note,
        arrival_inventory_ok, check_in_completed_at, departure_extras_note,
        departure_extras_amount_usd, keys_returned, keys_note, check_out_completed_at,
        legal_documents_ack_at, legal_ack_doc_ids_json, updated_at
      ) VALUES (
        @reservation_id, @legal_country_code, @id_document_verified_at, @deposit_amount_usd,
        @deposit_method, @deposit_received_at, @arrival_signature_at, @arrival_inventory_note,
        @arrival_inventory_ok, @check_in_completed_at, @departure_extras_note,
        @departure_extras_amount_usd, @keys_returned, @keys_note, @check_out_completed_at,
        @legal_documents_ack_at, @legal_ack_doc_ids_json, datetime('now')
      )
      ON CONFLICT(reservation_id) DO UPDATE SET
        legal_country_code = excluded.legal_country_code,
        id_document_verified_at = excluded.id_document_verified_at,
        deposit_amount_usd = excluded.deposit_amount_usd,
        deposit_method = excluded.deposit_method,
        deposit_received_at = excluded.deposit_received_at,
        arrival_signature_at = excluded.arrival_signature_at,
        arrival_inventory_note = excluded.arrival_inventory_note,
        arrival_inventory_ok = excluded.arrival_inventory_ok,
        check_in_completed_at = excluded.check_in_completed_at,
        departure_extras_note = excluded.departure_extras_note,
        departure_extras_amount_usd = excluded.departure_extras_amount_usd,
        keys_returned = excluded.keys_returned,
        keys_note = excluded.keys_note,
        check_out_completed_at = excluded.check_out_completed_at,
        legal_documents_ack_at = excluded.legal_documents_ack_at,
        legal_ack_doc_ids_json = excluded.legal_ack_doc_ids_json,
        updated_at = datetime('now')`,
    ).run({
      reservation_id: base.reservation_id,
      legal_country_code: base.legal_country_code,
      id_document_verified_at: base.id_document_verified_at,
      deposit_amount_usd: base.deposit_amount_usd,
      deposit_method: base.deposit_method,
      deposit_received_at: base.deposit_received_at,
      arrival_signature_at: base.arrival_signature_at,
      arrival_inventory_note: base.arrival_inventory_note,
      arrival_inventory_ok: base.arrival_inventory_ok,
      check_in_completed_at: base.check_in_completed_at,
      departure_extras_note: base.departure_extras_note,
      departure_extras_amount_usd: base.departure_extras_amount_usd,
      keys_returned: base.keys_returned,
      keys_note: base.keys_note,
      check_out_completed_at: base.check_out_completed_at,
      legal_documents_ack_at: base.legal_documents_ack_at,
      legal_ack_doc_ids_json: base.legal_ack_doc_ids_json,
    });

    const saved = getWorkflowRow(reservationId)!;
    res.json({
      reservation: {
        id: summary.id,
        clientId: summary.client_id,
        clientName: summary.client_name,
        bungalowCodes: summary.bungalow_codes,
        start: summary.start_date,
        end: summary.end_date,
        status: summary.status,
      },
      workflow: rowToPublic(saved),
      hasPersistedWorkflow: true,
    });
  });

  return r;
}
