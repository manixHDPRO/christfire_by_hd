import { db } from "./db.js";
import { roleHasPermission } from "./permissions.js";

/** Accès supervision trésorerie : voir toutes les caisses, tous les rapports et journaux. */
export function roleSeesAllCashRegisterData(role: string): boolean {
  return roleHasPermission(role, "finance.treasury");
}

export function assignedPointOfSaleIdsForUser(userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT point_of_sale_id FROM app_user_point_of_sale WHERE user_id = ? ORDER BY point_of_sale_id ASC`,
    )
    .all(userId) as { point_of_sale_id: string }[];
  return rows.map((r) => r.point_of_sale_id);
}

export function userMayAccessPointOfSale(role: string, userId: string, pointOfSaleId: string): boolean {
  if (roleSeesAllCashRegisterData(role)) return true;
  return assignedPointOfSaleIdsForUser(userId).includes(pointOfSaleId);
}
