import type { BookingChannel, Reservation, ReservationKind } from "@/types";

/** Bungalows couverts par une réservation (individuel = un seul code). */
export function reservationBungalowIds(r: Reservation): string[] {
  if (Array.isArray(r.bungalowIds) && r.bungalowIds.length > 0) return r.bungalowIds;
  return [r.bungalowId];
}

export function reservationIsGroup(r: Pick<Reservation, "reservationKind">): boolean {
  return r.reservationKind === "group";
}

export function normalizeReservationKind(k: string | undefined | null): ReservationKind {
  return k === "group" ? "group" : "individual";
}

/** Normalise les champs renvoyés par l’API (rétrocompatibilité). */
export function normalizeReservationFromApi(r: Reservation): Reservation {
  const kind = normalizeReservationKind(r.reservationKind);
  const ids = reservationBungalowIds(r);
  const primary = ids[0] ?? r.bungalowId;
  const guestCount =
    kind === "group"
      ? Math.max(2, Math.min(99, Math.floor(Number(r.guestCount ?? 2))))
      : 1;
  const ch = (r.bookingChannel ?? "direct") as BookingChannel;
  return {
    ...r,
    reservationKind: kind,
    bungalowIds: ids,
    bungalowId: primary,
    guestCount,
    bookingChannel: ch,
  };
}
