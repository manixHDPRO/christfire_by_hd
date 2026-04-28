import type { BungalowCategory, CategoryRate } from "@/types";

/** Ajoute des jours à une date ISO YYYY-MM-DD (calendrier grégorien, UTC). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Nuits facturées pour un séjour en intervalle [start, end) :
 * la date de fin est le jour de départ (non compté comme nuitée).
 */
export function nightsInStay(start: string, end: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) return [];
  const out: string[] = [];
  let cur = start;
  while (cur < end) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

export function rateRowForCategory(rates: CategoryRate[], category: BungalowCategory): CategoryRate | undefined {
  return rates.find((r) => r.category === category);
}

/** Prix / nuit pour une réservation : tarif bungalow s’il existe, sinon grille Paramètres pour la catégorie. */
export function effectiveNightlyRateUsd(
  bungalow: { category: BungalowCategory; pricePerNightUsd?: number | null },
  rates: CategoryRate[],
): number {
  const o = bungalow.pricePerNightUsd;
  if (o != null && Number.isFinite(o) && o >= 0) return Math.round(o);
  return rateRowForCategory(rates, bungalow.category)?.pricePerNightUSD ?? 0;
}

/** Total $ pour le séjour : nombre de nuits × prix / nuit (USD) selon la catégorie. */
export function computeStayAmountUSD(
  category: BungalowCategory,
  start: string,
  end: string,
  rates: CategoryRate[],
): number {
  const row = rateRowForCategory(rates, category);
  if (!row) return 0;
  const n = nightsInStay(start, end).length;
  return n * row.pricePerNightUSD;
}
