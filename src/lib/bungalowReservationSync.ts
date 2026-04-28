import type { Bungalow, Reservation } from "@/types";
import { reservationBungalowIds } from "@/lib/reservationBungalows";

export function todayUtcISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Aligne Disponible / Réservé / Occupé selon les séjours actifs (aujourd’hui ∈ [start, end)).
 * Occupé = réservation « En cours » (client sur place) ; Réservé = « Confirmé » ou « En attente paiement » sans check-in.
 * « Maintenance » et « Hors service » ne sont pas modifiés.
 */
export function syncBungalowsWithReservations(bungalows: Bungalow[], reservations: Reservation[]): Bungalow[] {
  const today = todayUtcISODate();
  return bungalows.map((b) => {
    if (b.status === "Maintenance" || b.status === "Hors service") return b;
    const checkedIn = reservations.some(
      (r) =>
        reservationBungalowIds(r).includes(b.id) &&
        r.status === "En cours" &&
        r.start <= today &&
        r.end > today,
    );
    const reservedOnly = reservations.some(
      (r) =>
        reservationBungalowIds(r).includes(b.id) &&
        (r.status === "Confirmé" || r.status === "En attente paiement") &&
        r.start <= today &&
        r.end > today,
    );
    const next: Bungalow["status"] = checkedIn ? "Occupé" : reservedOnly ? "Réservé" : "Disponible";
    if (next === b.status) return b;
    return { ...b, status: next };
  });
}
