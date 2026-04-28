import type { PaymentCurrencyCode } from "@/types";

/** Libellé court pour une ligne d’encaissement (nominal + devise + équivalent USD si CDF). */
export function formatPaymentNominalWithUsdEquiv(
  currency: PaymentCurrencyCode | undefined,
  amountNominal: number,
  amountUsdEquivalent: number | undefined,
): string {
  const cur: PaymentCurrencyCode = currency === "CDF" ? "CDF" : "USD";
  const usd = amountUsdEquivalent ?? amountNominal;
  if (cur !== "CDF") {
    return `${amountNominal} $`;
  }
  return `${amountNominal.toLocaleString("fr-CD")} FC (équiv. ${usd} $)`;
}
