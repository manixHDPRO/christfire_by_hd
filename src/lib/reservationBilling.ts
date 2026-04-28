import type { Invoice, PaymentStatus, Reservation } from "@/types";
import { reservationGrandTotal } from "@/lib/reservationPayment";

/** Statut de paiement dérivé du cumul encaissé vs total dû (séjour + pénalité). */
export function reservationPaymentStatus(r: Reservation): PaymentStatus {
  const due = reservationGrandTotal(r.amount, r.latePenaltyUsd ?? 0);
  const paid = r.amountPaid ?? 0;
  if (due <= 0) return "Payé";
  if (paid >= due) return "Payé";
  if (paid > 0) return "Partiel";
  return "En attente";
}

/** Numéro de pièce lisible (pas de table `invoices` en base). */
export function reservationBillingNumber(r: Reservation): string {
  const y = r.start.slice(0, 4);
  const short = r.id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `CF-${y}-${short}`;
}

/** Une ligne facturation / encaissement par réservation. */
export function reservationToBillingRow(r: Reservation): Invoice {
  return {
    id: `bill-${r.id}`,
    reservationId: r.id,
    clientId: r.clientId,
    number: reservationBillingNumber(r),
    total: reservationGrandTotal(r.amount, r.latePenaltyUsd ?? 0),
    payment: reservationPaymentStatus(r),
    issuedAt: r.start,
    lineLabel: "Séjour (hébergement)",
  };
}

export function reservationsOpenForBilling(reservations: Reservation[]): number {
  return reservations.filter((r) => reservationPaymentStatus(r) !== "Payé").length;
}
