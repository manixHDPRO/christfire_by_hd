import { db } from "./db.js";

export function cdfPerUsdNow(): number {
  const row = db.prepare("SELECT cdf_per_usd FROM app_exchange_rate WHERE id = 1").get() as
    | { cdf_per_usd: number }
    | undefined;
  return Math.max(1, Math.floor(row?.cdf_per_usd ?? 1));
}

export function lineTotalCdf(qty: number, unitUsdCents: number, cdfPerUsd: number): number {
  return Math.round((qty * unitUsdCents * cdfPerUsd) / 100);
}
