/**
 * Interprète un montant entier saisi pour le livre de caisse (CDF/USD en unités entières).
 * - Points : séparateurs de milliers (ex. 100.000.000.000).
 * - Virgule : partie décimale (arrondi à l’entier le plus proche).
 */
export function parseLedgerIntegerInput(raw: string): number {
  let s = raw.replace(/\s/g, "").replace(/\u202f/g, "").trim();
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  if (lastComma !== -1) {
    const intPart = s.slice(0, lastComma).replace(/\./g, "");
    const decPart = s.slice(lastComma + 1).replace(/\./g, "");
    const n = Number(`${intPart}.${decPart}`);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  const dotCount = (s.match(/\./g) ?? []).length;
  if (dotCount === 1) {
    const [whole, frac = ""] = s.split(".");
    if (frac.length >= 1 && frac.length <= 2) {
      const n = Number(`${whole}.${frac}`);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
  }
  const n = Number(s.replace(/\./g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
