import type { PaymentCurrencyCode } from "@/types";

/** Même logique que le serveur : CDF → USD pour solder un montant tenu en USD (floor). */
export function nominalToUsdFloor(nominal: number, currency: PaymentCurrencyCode, cdfPerUsd: number): number {
  const n = Math.max(0, Math.floor(nominal));
  if (currency === "USD") return n;
  const fx = Math.max(1, Math.floor(cdfPerUsd));
  return Math.max(0, Math.floor(n / fx));
}

/** Préremplissage du champ de saisie : reste en USD → montant nominal dans la devise choisie. */
export function nominalPresetForResteUsd(resteUsd: number, currency: PaymentCurrencyCode, cdfPerUsd: number): string {
  if (resteUsd <= 0) return "";
  if (currency === "USD") return String(resteUsd);
  const fx = Math.max(1, Math.floor(cdfPerUsd));
  return String(resteUsd * fx);
}
