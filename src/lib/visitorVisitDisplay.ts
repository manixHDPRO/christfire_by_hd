import type { Client, VisitorVisitKind } from "@/types";

export function isVisitorVisitKind(v: string | null | undefined): v is VisitorVisitKind {
  return v === "individual" || v === "group" || v === "family";
}

/** Effectif total pour affichage (héritage : ancienne colonne seule). */
export function visitorHeadcount(c: Client): number | null {
  const k = c.visitorVisitKind;
  if (isVisitorVisitKind(k)) {
    if (k === "individual") return 1;
    const a = Math.max(0, Math.floor(c.visitorAdultsCount ?? 0));
    const m = Math.max(0, Math.floor(c.visitorMinorsCount ?? 0));
    const t = a + m;
    return t >= 1 ? Math.min(999, t) : null;
  }
  const p = c.visitorPartyCount;
  if (p != null && p >= 1) return Math.min(999, Math.floor(p));
  return null;
}

/** Libellé court pour listes et paiement. */
export function visitorVisitShortLabel(c: Client): string | null {
  const k = c.visitorVisitKind;
  if (isVisitorVisitKind(k)) {
    if (k === "individual") return "Individuel";
    const a = Math.max(0, Math.floor(c.visitorAdultsCount ?? 0));
    const m = Math.max(0, Math.floor(c.visitorMinorsCount ?? 0));
    if (k === "group") return `Groupe · ${a} adulte(s), ${m} mineur(s)`;
    return `Famille · ${a} adulte(s), ${m} mineur(s)`;
  }
  const p = visitorHeadcount(c);
  return p != null ? `${p} pers.` : null;
}
