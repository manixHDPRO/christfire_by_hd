/**
 * Politique de suppression des données métier
 * --------------------------------------------
 * Les actions « supprimer » côté API exécutent un **DELETE SQL** sur la ligne concernée.
 * Il n’existe **pas** de corbeille, de champ `deleted_at` ni de réactivation depuis l’application.
 *
 * La **désactivation** d’un compte utilisateur (`users.active = 0`) reste distincte : elle conserve
 * la ligne et l’historique lié, sans effacer l’identité en base.
 */

import { db } from "./db.js";
import { countUsersWithAppAdminRole, getAppUserRoleByLabel } from "./appUserRoles.js";

export type HardDeleteUserResult =
  | { ok: true; deleted: { id: string; name: string; email: string; role: string } }
  | { ok: false; code: "not_found" | "last_admin" };

/**
 * Suppression définitive d’un utilisateur : sessions puis ligne `users` (ordre explicite ;
 * les FK vers `users` ailleurs sont en SET NULL ou CASCADE selon les tables).
 */
export function hardDeleteUser(userId: string): HardDeleteUserResult {
  const target = db
    .prepare("SELECT id, role, name, email FROM users WHERE id = ?")
    .get(userId) as { id: string; role: string; name: string; email: string } | undefined;
  if (!target) return { ok: false, code: "not_found" };
  if (getAppUserRoleByLabel(target.role)?.is_app_admin === 1 && countUsersWithAppAdminRole() <= 1) {
    return { ok: false, code: "last_admin" };
  }

  let removed = false;
  db.transaction(() => {
    db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId);
    const info = db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    removed = info.changes === 1;
  })();

  if (!removed) return { ok: false, code: "not_found" };
  return { ok: true, deleted: target };
}

export type HardDeleteClientResult =
  | { ok: true; deleted: { id: string; name: string; email: string } }
  | { ok: false; code: "not_found" | "has_reservations" | "has_visitor_ledger" };

/**
 * Suppression définitive d’un client (ligne `clients`), si aucune donnée bloquante.
 */
export function hardDeleteClient(clientId: string): HardDeleteClientResult {
  const target = db
    .prepare("SELECT id, name, email FROM clients WHERE id = ?")
    .get(clientId) as { id: string; name: string; email: string } | undefined;
  if (!target) return { ok: false, code: "not_found" };

  const resCount = db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE client_id = ?").get(clientId) as {
    c: number;
  };
  if (resCount.c > 0) return { ok: false, code: "has_reservations" };

  const ledCount = db
    .prepare("SELECT COUNT(*) AS c FROM visitor_entry_payment_ledger WHERE client_id = ?")
    .get(clientId) as { c: number };
  if (ledCount.c > 0) return { ok: false, code: "has_visitor_ledger" };

  const info = db.prepare("DELETE FROM clients WHERE id = ?").run(clientId);
  if (info.changes !== 1) return { ok: false, code: "not_found" };
  return { ok: true, deleted: target };
}
