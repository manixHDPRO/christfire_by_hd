import type { AuthUser } from "@/types";
import { FINANCE_MENU_GATE } from "./financeModule";
import { userHasAnyPermission } from "./permissions";

/** Filtrage du menu principal (hors entrées « Hébergement », voir `hebergementPermissions.ts`). */
export type MainNavGate = readonly string[] | "any" | "dashboard" | "app_admin";

export const MAIN_NAV_ROUTE_PERMS: Readonly<Record<string, MainNavGate>> = {
  "/": "dashboard",
  "/finance": [...FINANCE_MENU_GATE],
  "/rapports": ["finance.reports", "lodging.reservations"],
  "/paiement": ["finance.payments"],
  "/comptoir": ["finance.counter"],
  "/tresorerie": [
    "finance.treasury",
    "finance.counter",
    "lodging.reception_cash",
    "lodging.stay_reception",
  ],
  "/livre-caisse": ["finance.cash_book"],
  "/clients": [
    "directory.clients",
    "lodging.reservations",
    "lodging.stay_reception",
    "lodging.reception_cash",
  ],
  "/facturation": ["finance.invoices"],
  "/cloture-audit": ["accounting.close_day"],
  "/stocks": [
    "logistics.inventory",
    "logistics.po_approve_manager",
    "logistics.po_approve_dg",
    "logistics.po_release_finance",
    "logistics.po_release_accounting",
  ],
  /** Réservé aux rôles « administrateur application » (`isAppAdmin`), pas à la matrice seule. */
  "/parametres": "app_admin",
};

export function userCanSeeMainNavPath(user: AuthUser | null | undefined, path: string): boolean {
  if (!user) return false;
  if (path.startsWith("/logistique/")) {
    return userCanSeeMainNavPath(user, "/stocks");
  }
  if (user.isAppAdmin) return true;
  const gate = MAIN_NAV_ROUTE_PERMS[path];
  if (gate === "any") return true;
  if (gate === "app_admin") return !!user.isAppAdmin;
  if (gate === "dashboard") return (user.permissions?.length ?? 0) > 0;
  if (!gate) return false;
  return userHasAnyPermission(user, gate);
}

/** Pour les liens avec query string (ex. palette de commandes). */
export function userCanSeeMainNavTo(user: AuthUser | null | undefined, to: string): boolean {
  const q = to.indexOf("?");
  const path = q >= 0 ? to.slice(0, q) : to;
  return userCanSeeMainNavPath(user, path);
}

/** Pour les garde-routes : chemins protégés par une liste de codes (pas le tableau de bord ni Paramètres). */
export function mainNavRequiredPermissions(path: string): readonly string[] {
  const g = MAIN_NAV_ROUTE_PERMS[path];
  if (g === "any" || g === "dashboard" || g === "app_admin" || !g) return [];
  return g;
}
