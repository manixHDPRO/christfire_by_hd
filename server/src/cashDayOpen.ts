import type { Response } from "express";
import { db } from "./db.js";
import { roleHasPermission } from "./permissions.js";

/** Qui peut consulter si la journée caisse est ouverte (bannières, formulaires). */
export const CASH_DAY_STATUS_READ_PERMS = [
  "finance.counter",
  "sales.floor",
  "finance.treasury",
  "finance.payments",
  "lodging.reservations",
  "lodging.stay_reception",
  "lodging.reception_cash",
  "directory.clients",
] as const;

export function localBusinessDateNow(): string {
  const row = db.prepare(`SELECT strftime('%Y-%m-%d', 'now', 'localtime') AS d`).get() as { d: string };
  return row.d;
}

export function roleBypassesCashDayGate(role: string): boolean {
  return roleHasPermission(role, "finance.treasury");
}

export function isCashDayOpen(businessDate: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM treasury_cash_day_openings WHERE business_date = ?`)
    .get(businessDate) as { x: number } | undefined;
  return !!row;
}

/** Si la journée n’est pas ouverte et que le rôle n’est pas trésorerie, envoie 403 et retourne false. */
export function requireCashDayOpenForRole(role: string, businessDate: string, res: Response): boolean {
  if (roleBypassesCashDayGate(role)) return true;
  if (isCashDayOpen(businessDate)) return true;
  res.status(403).json({ code: "cash_day_not_opened" });
  return false;
}
