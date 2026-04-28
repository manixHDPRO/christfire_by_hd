import { db } from "./db.js";

export type PaymentCurrency = "USD" | "CDF";

export function getCdfPerUsdFromDb(): number {
  const row = db
    .prepare("SELECT cdf_per_usd FROM app_exchange_rate WHERE id = 1")
    .get() as { cdf_per_usd: number } | undefined;
  const n = row?.cdf_per_usd;
  if (typeof n === "number" && Number.isFinite(n) && n >= 1) return Math.floor(n);
  return 2850;
}

/**
 * Montant saisi (entier, USD ou CDF) → équivalent USD crédité sur la réservation / droit d’entrée.
 * CDF : conversion conservatrice (floor) pour éviter de dépasser le solde en USD.
 */
export function nominalToUsdEquivalent(amount: number, currency: PaymentCurrency): number {
  const a = Math.max(0, Math.floor(amount));
  if (currency === "USD") return a;
  const fx = getCdfPerUsdFromDb();
  if (fx <= 0) return 0;
  return Math.max(0, Math.floor(a / fx));
}

export function parsePaymentCurrency(raw: unknown): PaymentCurrency {
  return raw === "CDF" ? "CDF" : "USD";
}
