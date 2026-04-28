import type { ReservationStatus } from "@/types";

/** Part minimale du montant total acceptée comme acompte pour confirmer (30 %). */
export const DEPOSIT_MIN_FRACTION = 0.3;

/** Total à régler : séjour + pénalité retard d’occupation (USD entiers). */
export function reservationGrandTotal(stayAmountUsd: number, latePenaltyUsd: number): number {
  const stay = Math.max(0, Math.floor(stayAmountUsd));
  const pen = Math.max(0, Math.floor(latePenaltyUsd ?? 0));
  return stay + pen;
}

export function minimumDepositAmount(total: number): number {
  if (total <= 0) return 0;
  return Math.ceil(total * DEPOSIT_MIN_FRACTION);
}

/** Confirmation : total payé OU acompte au moins égal au minimum (sur total séjour + pénalité). */
export function reservationPaymentCoversConfirmation(
  stayAmountUsd: number,
  latePenaltyUsd: number,
  amountPaid: number,
): boolean {
  const total = reservationGrandTotal(stayAmountUsd, latePenaltyUsd);
  if (total <= 0) return true;
  return amountPaid >= total || amountPaid >= minimumDepositAmount(total);
}

export function statusAllowsAutoConfirmAfterPayment(status: ReservationStatus): boolean {
  return status === "En attente paiement" || status === "En cours";
}
