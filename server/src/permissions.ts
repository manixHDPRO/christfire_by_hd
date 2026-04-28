import { db } from "./db.js";
import { ALL_PERMISSION_CODES, PERMISSION_CODE_SET } from "./permissionCodes.js";

const grantCache = new Map<string, string[]>();

export function invalidateRolePermissionCache(roleId?: string): void {
  if (roleId) grantCache.delete(roleId);
  else grantCache.clear();
}

/** Droits explicites en base (ignorer is_app_admin — utiliser permissionsForRoleRow pour l’effectif). */
export function getStoredPermissionCodesForRoleId(roleId: string): string[] {
  const hit = grantCache.get(roleId);
  if (hit) return hit;
  const rows = db
    .prepare(`SELECT permission_code FROM app_role_permissions WHERE role_id = ? ORDER BY permission_code ASC`)
    .all(roleId) as { permission_code: string }[];
  const codes = rows.map((r) => r.permission_code);
  grantCache.set(roleId, codes);
  return codes;
}

export function permissionsForRoleRow(row: { id: string; is_app_admin: number }): string[] {
  if (row.is_app_admin === 1) return [...ALL_PERMISSION_CODES];
  return getStoredPermissionCodesForRoleId(row.id);
}

export function roleHasPermission(roleLabel: string, code: string): boolean {
  const r = db
    .prepare(`SELECT id, is_app_admin FROM app_user_roles WHERE label = ? COLLATE NOCASE`)
    .get(roleLabel.trim()) as { id: string; is_app_admin: number } | undefined;
  if (!r) return false;
  if (r.is_app_admin === 1) return true;
  return getStoredPermissionCodesForRoleId(r.id).includes(code);
}

export function roleHasAnyPermission(roleLabel: string, codes: string[]): boolean {
  return codes.some((c) => roleHasPermission(roleLabel, c));
}

function assertKnownCodes(codes: string[]): void {
  for (const c of codes) {
    if (!PERMISSION_CODE_SET.has(c)) throw new Error(`unknown_permission:${c}`);
  }
}

export function replaceRolePermissions(roleId: string, codes: string[]): void {
  assertKnownCodes(codes);
  const uniq = [...new Set(codes)].sort();
  db.transaction(() => {
    db.prepare(`DELETE FROM app_role_permissions WHERE role_id = ?`).run(roleId);
    const ins = db.prepare(
      `INSERT INTO app_role_permissions (role_id, permission_code) VALUES (@role_id, @permission_code)`,
    );
    for (const permission_code of uniq) {
      ins.run({ role_id: roleId, permission_code });
    }
  })();
  invalidateRolePermissionCache(roleId);
}

export function clearStoredPermissionsForRole(roleId: string): void {
  db.prepare(`DELETE FROM app_role_permissions WHERE role_id = ?`).run(roleId);
  invalidateRolePermissionCache(roleId);
}

/** Ancienne convention « gestion comptes » → jeu de droits par défaut. */
export const LEGACY_MANAGE_USERS_PERMISSION_PRESET = [
  "users.invite",
  "users.manage",
  "accounting.close_day",
] as const;

export function syncCanManageAppUsersColumn(roleId: string): void {
  const row = db
    .prepare(`SELECT is_app_admin FROM app_user_roles WHERE id = ?`)
    .get(roleId) as { is_app_admin: number } | undefined;
  if (!row) return;
  if (row.is_app_admin === 1) {
    db.prepare(`UPDATE app_user_roles SET can_manage_app_users = 1 WHERE id = ?`).run(roleId);
    return;
  }
  const codes = getStoredPermissionCodesForRoleId(roleId);
  const flag = codes.includes("users.invite") || codes.includes("users.manage") ? 1 : 0;
  db.prepare(`UPDATE app_user_roles SET can_manage_app_users = ? WHERE id = ?`).run(flag, roleId);
}
