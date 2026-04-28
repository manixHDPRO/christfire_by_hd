import { db } from "./db.js";

function todayUtcDateISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Met à jour Disponible / Réservé / Occupé selon les réservations actives (aujourd’hui ∈ [start, end)).
 * — Occupé : client sur place (réservation « En cours »).
 * — Réservé : réservation « Confirmé » ou « En attente paiement » sur les dates (pas encore check-in).
 * Ne modifie pas Maintenance ni Hors service.
 */
export function syncBungalowStatusForDb(bungalowId: string): void {
  const row = db.prepare("SELECT status FROM bungalows WHERE id = ?").get(bungalowId) as
    | { status: string }
    | undefined;
  if (!row || row.status === "Maintenance" || row.status === "Hors service") return;

  const today = todayUtcDateISO();

  const checkedIn = db
    .prepare(
      `SELECT 1 AS x FROM reservations r
       WHERE r.status = 'En cours'
         AND r.start_date <= @today
         AND r.end_date > @today
         AND (
           r.bungalow_id = @bungalowId
           OR EXISTS (
             SELECT 1 FROM reservation_bungalows rb
             WHERE rb.reservation_id = r.id AND rb.bungalow_id = @bungalowId
           )
         )
       LIMIT 1`,
    )
    .get({ bungalowId, today }) as { x: number } | undefined;

  if (checkedIn) {
    if (row.status !== "Occupé") {
      db.prepare("UPDATE bungalows SET status = ? WHERE id = ?").run("Occupé", bungalowId);
    }
    return;
  }

  const reservedOnly = db
    .prepare(
      `SELECT 1 AS x FROM reservations r
       WHERE r.status IN ('Confirmé', 'En attente paiement')
         AND r.start_date <= @today
         AND r.end_date > @today
         AND (
           r.bungalow_id = @bungalowId
           OR EXISTS (
             SELECT 1 FROM reservation_bungalows rb
             WHERE rb.reservation_id = r.id AND rb.bungalow_id = @bungalowId
           )
         )
       LIMIT 1`,
    )
    .get({ bungalowId, today }) as { x: number } | undefined;

  const next = reservedOnly ? "Réservé" : "Disponible";
  if (next !== row.status) {
    db.prepare("UPDATE bungalows SET status = ? WHERE id = ?").run(next, bungalowId);
  }
}

/** Recalcule le statut de chaque bungalow lié à une réservation (séjour multi-logements). */
export function syncBungalowsForReservation(reservationId: string): void {
  const rows = db
    .prepare(
      `SELECT bungalow_id FROM reservation_bungalows WHERE reservation_id = ? ORDER BY sort_order ASC, bungalow_id ASC`,
    )
    .all(reservationId) as { bungalow_id: string }[];
  if (rows.length === 0) {
    const row = db.prepare("SELECT bungalow_id FROM reservations WHERE id = ?").get(reservationId) as
      | { bungalow_id: string }
      | undefined;
    if (row) syncBungalowStatusForDb(row.bungalow_id);
    return;
  }
  for (const r of rows) syncBungalowStatusForDb(r.bungalow_id);
}
