/** Codes référentiels inventaire (catégories article, unités) : minuscules, [a-z0-9_]. */
export function normalizeStockRefCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export const STOCK_REF_CODE_RE = /^[a-z0-9_]{1,64}$/;
