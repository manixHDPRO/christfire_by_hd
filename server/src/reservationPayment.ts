const DEPOSIT_MIN_FRACTION = 0.3;

/** Total à régler : montant du séjour + pénalité de retard d’occupation (USD entiers). */
export function reservationGrandTotal(stayAmountUsd: number, latePenaltyUsd: number): number {
  const stay = Math.max(0, Math.floor(stayAmountUsd));
  const pen = Math.max(0, Math.floor(latePenaltyUsd));
  return stay + pen;
}

export function minimumDepositAmount(total: number): number {
  if (total <= 0) return 0;
  return Math.ceil(total * DEPOSIT_MIN_FRACTION);
}

export function reservationPaymentCoversConfirmation(
  stayAmountUsd: number,
  latePenaltyUsd: number,
  amountPaid: number,
): boolean {
  const total = reservationGrandTotal(stayAmountUsd, latePenaltyUsd);
  if (total <= 0) return true;
  return amountPaid >= total || amountPaid >= minimumDepositAmount(total);
}

/** Statuts pour lesquels un encaissement suffisant peut faire passer la réservation en « Confirmé ». */
export function statusAllowsAutoConfirmAfterPayment(status: string): boolean {
  return status === "En attente paiement" || status === "En cours";
}
