import type { AuthUser } from "@/types";
import { userHasAnyPermission } from "./permissions";

/**
 * Ouvre le bloc menu « Finance » (hub, fil d’Ariane Finance) et la route `/finance`.
 * Ne contient pas `lodging.reservations` : avec seules les réservations, l’accès à `/rapports`
 * reste possible mais le lien apparaît sous « Hébergement » (voir navigation).
 */
export const FINANCE_MENU_GATE = [
  "finance.payments",
  "finance.invoices",
  "finance.counter",
  "finance.treasury",
  "finance.cash_book",
  "finance.reports",
  "accounting.close_day",
] as const;

/** @deprecated alias — préférer `FINANCE_MENU_GATE`. */
export const FINANCE_HUB_ANY_OF = FINANCE_MENU_GATE;

export function userCanSeeFinanceHub(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isAppAdmin) return true;
  return userHasAnyPermission(user, [...FINANCE_MENU_GATE]);
}

/** Chemins considérés comme « sous le module Finance » (fil d’Ariane, surbrillance nav). */
export const FINANCE_MODULE_PATHS: readonly string[] = [
  "/finance",
  "/paiement",
  "/facturation",
  "/comptoir",
  "/tresorerie",
  "/livre-caisse",
  "/rapports",
  "/cloture-audit",
];

export function pathnameUnderFinanceModule(pathname: string): boolean {
  const p = pathname.split("?")[0] ?? pathname;
  return FINANCE_MODULE_PATHS.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export type FinanceHubCard = {
  to: string;
  title: string;
  description: string;
  /** Sous-domaine affiché sur la carte (ex. trésorerie). */
  branch?: "treasury" | "counter" | "billing" | "lodging" | "audit" | "reports" | "cashbook";
  anyOf: readonly string[];
};

/** Cartes du hub : l’ordre suit le flux opérationnel. */
export const FINANCE_HUB_CARDS: readonly FinanceHubCard[] = [
  {
    to: "/paiement",
    title: "Encaissements",
    description: "Paiements liés aux réservations et journal des encaissements.",
    branch: "lodging",
    anyOf: ["finance.payments"],
  },
  {
    to: "/facturation",
    title: "Facturation",
    description: "Factures séjours, droit d’entrée visiteurs et suivi de facturation.",
    branch: "billing",
    anyOf: ["finance.invoices"],
  },
  {
    to: "/comptoir",
    title: "Vente comptoir",
    description: "Buvette, boutique : ventes ponctuelles en CDF par point de vente.",
    branch: "counter",
    anyOf: ["finance.counter"],
  },
  {
    to: "/tresorerie",
    title: "Trésorerie",
    description: "Branche trésorerie : synthèse des caisses, rapports journaliers et écarts.",
    branch: "treasury",
    anyOf: [
      "finance.treasury",
      "finance.counter",
      "lodging.reception_cash",
      "lodging.stay_reception",
    ],
  },
  {
    to: "/livre-caisse",
    title: "Livre de caisse",
    description:
      "Soldes par compte (caisse / banque), traçabilité des dépenses et des dépôts sur vos comptes bancaires.",
    branch: "cashbook",
    anyOf: ["finance.cash_book"],
  },
  {
    to: "/rapports",
    title: "Rapports & pilotage",
    description: "Indicateurs, occupation, canaux et exports pour la direction.",
    branch: "reports",
    anyOf: ["finance.reports", "lodging.reservations"],
  },
  {
    to: "/cloture-audit",
    title: "Clôture & audit",
    description: "Night audit et clôture de journée comptable.",
    branch: "audit",
    anyOf: ["accounting.close_day"],
  },
] as const;

export function visibleFinanceHubCards(user: AuthUser | null | undefined): FinanceHubCard[] {
  if (!user) return [];
  if (user.isAppAdmin) return [...FINANCE_HUB_CARDS];
  return FINANCE_HUB_CARDS.filter((c) => userHasAnyPermission(user, c.anyOf));
}
