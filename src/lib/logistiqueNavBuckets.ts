import type { AuthUser } from "@/types";
import { userHasAnyPermission, userHasPermission } from "./permissions";

/** Aligné sur la page logistique (accès BC sans inventaire complet). */
const PO_LOGISTIQUE_ACCESS = [
  "logistics.po_approve_manager",
  "logistics.po_approve_dg",
  "logistics.po_release_finance",
  "logistics.po_release_accounting",
] as const;

export const LOGISTIQUE_SECTION_IDS = [
  "vue",
  "articles",
  "seuils",
  "a-commander",
  "fournisseurs",
  "commandes",
  "reception",
  "transfert",
  "inventaire",
  "historique",
] as const;

export type LogistiqueSectionId = (typeof LOGISTIQUE_SECTION_IDS)[number];

const INVENTORY_SECTIONS: readonly LogistiqueSectionId[] = [
  "vue",
  "articles",
  "seuils",
  "transfert",
  "inventaire",
  "historique",
];

const PURCHASING_SECTIONS: readonly LogistiqueSectionId[] = [
  "a-commander",
  "fournisseurs",
  "commandes",
  "reception",
];

const SECTION_LABELS: Record<LogistiqueSectionId, string> = {
  vue: "Vue d’ensemble",
  articles: "Articles",
  seuils: "Seuils & réappro",
  "a-commander": "À commander",
  fournisseurs: "Fournisseurs",
  commandes: "Bons de commande",
  reception: "Réception",
  transfert: "Transfert",
  inventaire: "Inventaire",
  historique: "Historique",
};

export function getLogistiqueAllowedSections(user: AuthUser | null): readonly LogistiqueSectionId[] {
  if (!user) return [];
  const canFullInv = userHasPermission(user, "logistics.inventory");
  const canPoOnly = !canFullInv && userHasAnyPermission(user, [...PO_LOGISTIQUE_ACCESS]);
  if (canFullInv) return LOGISTIQUE_SECTION_IDS;
  if (canPoOnly) return ["commandes"];
  return LOGISTIQUE_SECTION_IDS;
}

export function logistiqueSectionPath(section: LogistiqueSectionId): string {
  return `/logistique/${section}`;
}

export function logistiqueSectionLabel(section: LogistiqueSectionId): string {
  return SECTION_LABELS[section];
}

export function visibleInventorySections(user: AuthUser | null): LogistiqueSectionId[] {
  const allowed = new Set(getLogistiqueAllowedSections(user));
  return INVENTORY_SECTIONS.filter((s) => allowed.has(s));
}

export function visiblePurchasingSections(user: AuthUser | null): LogistiqueSectionId[] {
  const allowed = new Set(getLogistiqueAllowedSections(user));
  return PURCHASING_SECTIONS.filter((s) => allowed.has(s));
}

function sectionFromPathname(pathname: string): LogistiqueSectionId | null {
  if (!pathname.startsWith("/logistique/")) return null;
  const seg = pathname.slice("/logistique/".length).split("/")[0];
  if (!seg || !(LOGISTIQUE_SECTION_IDS as readonly string[]).includes(seg)) return null;
  return seg as LogistiqueSectionId;
}

/** Indique si la zone logistique (routes `/logistique/…`) est concernée. */
export function logistiqueNavGroupActive(pathname: string, _search: string, user: AuthUser | null): boolean {
  const sec = sectionFromPathname(pathname);
  if (sec == null) return false;
  const allowed = new Set(getLogistiqueAllowedSections(user));
  return allowed.has(sec);
}

export function inventorySectionActive(pathname: string, user: AuthUser | null): boolean {
  const sec = sectionFromPathname(pathname);
  return sec != null && INVENTORY_SECTIONS.includes(sec) && new Set(getLogistiqueAllowedSections(user)).has(sec);
}

export function purchasingSectionActive(pathname: string, user: AuthUser | null): boolean {
  const sec = sectionFromPathname(pathname);
  return sec != null && PURCHASING_SECTIONS.includes(sec) && new Set(getLogistiqueAllowedSections(user)).has(sec);
}

export function defaultLogistiquePath(user: AuthUser | null): string {
  const tabs = getLogistiqueAllowedSections(user);
  const first = tabs[0] ?? "vue";
  return logistiqueSectionPath(first);
}

/** Ancienne URL `?onglet=` → chemin logistique. */
export function logistiquePathFromLegacyOnglet(onglet: string | null): string {
  if (onglet && (LOGISTIQUE_SECTION_IDS as readonly string[]).includes(onglet)) {
    return logistiqueSectionPath(onglet as LogistiqueSectionId);
  }
  return logistiqueSectionPath("vue");
}
