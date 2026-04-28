import { db } from "./db.js";
import { permissionsForRoleRow } from "./permissions.js";

export type AppUserRoleRow = {
  id: string;
  label: string;
  sort_order: number;
  is_system: number;
  is_app_admin: number;
  can_manage_app_users: number;
  allow_non_admin_invite: number;
};

export function listAppUserRolesOrdered(): AppUserRoleRow[] {
  return db
    .prepare(
      `SELECT id, label, sort_order, is_system, is_app_admin, can_manage_app_users, allow_non_admin_invite
       FROM app_user_roles ORDER BY sort_order ASC, label COLLATE NOCASE ASC`,
    )
    .all() as AppUserRoleRow[];
}

export function getAppUserRoleById(id: string): AppUserRoleRow | undefined {
  return db
    .prepare(
      `SELECT id, label, sort_order, is_system, is_app_admin, can_manage_app_users, allow_non_admin_invite
       FROM app_user_roles WHERE id = ?`,
    )
    .get(id) as AppUserRoleRow | undefined;
}

export function getAppUserRoleByLabel(label: string): AppUserRoleRow | undefined {
  return db
    .prepare(
      `SELECT id, label, sort_order, is_system, is_app_admin, can_manage_app_users, allow_non_admin_invite
       FROM app_user_roles WHERE label = ? COLLATE NOCASE`,
    )
    .get(label.trim()) as AppUserRoleRow | undefined;
}

export function isKnownRoleLabel(label: string): boolean {
  return getAppUserRoleByLabel(label) !== undefined;
}

export function authFlagsForRoleLabel(roleLabel: string): {
  isAppAdmin: boolean;
  canManageAppUsers: boolean;
  permissions: string[];
} {
  const r = getAppUserRoleByLabel(roleLabel);
  const isAppAdmin = r?.is_app_admin === 1;
  const permissions = r ? permissionsForRoleRow(r) : [];
  const canManageAppUsers =
    isAppAdmin || permissions.includes("users.invite") || permissions.includes("users.manage");
  return { isAppAdmin, canManageAppUsers, permissions };
}

export function countUsersWithAppAdminRole(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM users u
       INNER JOIN app_user_roles r ON u.role = r.label COLLATE NOCASE
       WHERE r.is_app_admin = 1`,
    )
    .get() as { c: number };
  return row.c;
}

export function countActiveUsersWithAppAdminRole(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM users u
       INNER JOIN app_user_roles r ON u.role = r.label COLLATE NOCASE
       WHERE r.is_app_admin = 1 AND u.active = 1`,
    )
    .get() as { c: number };
  return row.c;
}

export function countUsersWithRoleLabel(label: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = ? COLLATE NOCASE`)
    .get(label.trim()) as { c: number };
  return row.c;
}

export function countAppAdminRoleDefinitions(): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM app_user_roles WHERE is_app_admin = 1`).get() as { c: number };
  return row.c;
}
