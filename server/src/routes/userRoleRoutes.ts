import { randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import type { AppUserRoleRow } from "../appUserRoles.js";
import {
  countAppAdminRoleDefinitions,
  countUsersWithRoleLabel,
  getAppUserRoleById,
  listAppUserRolesOrdered,
} from "../appUserRoles.js";
import { recordAudit } from "../auditLog.js";
import { db } from "../db.js";
import { PERMISSION_CATALOG, PERMISSION_CODE_SET } from "../permissionCodes.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import {
  clearStoredPermissionsForRole,
  LEGACY_MANAGE_USERS_PERMISSION_PRESET,
  permissionsForRoleRow,
  replaceRolePermissions,
  syncCanManageAppUsersColumn,
} from "../permissions.js";

const permissionCodeSchema = z.string().refine((c) => PERMISSION_CODE_SET.has(c), "permission_inconnue");
const permissionsFieldSchema = z.array(permissionCodeSchema).optional();

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isAppAdmin: z.boolean().optional().default(false),
  canManageAppUsers: z.boolean().optional().default(false),
  allowNonAdminInvite: z.boolean().optional().default(false),
  permissions: permissionsFieldSchema,
});

const patchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isAppAdmin: z.boolean().optional(),
  canManageAppUsers: z.boolean().optional(),
  allowNonAdminInvite: z.boolean().optional(),
  permissions: permissionsFieldSchema,
});

function rowToApi(row: AppUserRoleRow) {
  return {
    id: row.id,
    label: row.label,
    sortOrder: row.sort_order,
    isSystem: row.is_system === 1,
    isAppAdmin: row.is_app_admin === 1,
    canManageAppUsers: row.can_manage_app_users === 1,
    allowNonAdminInvite: row.allow_non_admin_invite === 1,
    permissions: permissionsForRoleRow(row),
  };
}

function applyGrantsAfterCreate(roleId: string, isAppAdmin: boolean, body: z.infer<typeof createSchema>): void {
  if (isAppAdmin) {
    clearStoredPermissionsForRole(roleId);
  } else if (body.permissions !== undefined && body.permissions.length > 0) {
    replaceRolePermissions(roleId, body.permissions);
  } else if (body.canManageAppUsers) {
    replaceRolePermissions(roleId, [...LEGACY_MANAGE_USERS_PERMISSION_PRESET]);
  }
  syncCanManageAppUsersColumn(roleId);
}

export function userRoleRoutes(): Router {
  const r = createRouter();

  r.get("/", requireAuth, (_req: Request, res: Response) => {
    const roles = listAppUserRolesOrdered().map(rowToApi);
    res.json({ roles });
  });

  r.get("/permission-catalog", requireAuth, requireAnyPermission("admin.roles"), (_req: Request, res: Response) => {
    res.json({ catalog: PERMISSION_CATALOG });
  });

  r.post("/", requireAuth, requireAnyPermission("admin.roles"), (req: AuthedRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const label = parsed.data.label;
    const exists = db.prepare("SELECT 1 AS x FROM app_user_roles WHERE label = ? COLLATE NOCASE").get(label) as
      | { x: number }
      | undefined;
    if (exists) {
      res.status(409).json({ code: "label_taken" });
      return;
    }
    let sortOrder = parsed.data.sortOrder;
    if (sortOrder === undefined) {
      const m = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM app_user_roles").get() as { m: number };
      sortOrder = m.m + 1;
    }
    const id = randomUUID();
    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO app_user_roles (id, label, sort_order, is_system, is_app_admin, can_manage_app_users, allow_non_admin_invite)
           VALUES (@id, @label, @sort_order, 0, @is_app_admin, @can_manage_app_users, @allow_non_admin_invite)`,
        ).run({
          id,
          label,
          sort_order: sortOrder,
          is_app_admin: parsed.data.isAppAdmin ? 1 : 0,
          can_manage_app_users: parsed.data.canManageAppUsers ? 1 : 0,
          allow_non_admin_invite: parsed.data.allowNonAdminInvite ? 1 : 0,
        });
        applyGrantsAfterCreate(id, parsed.data.isAppAdmin, parsed.data);
      })();
    } catch {
      res.status(500).json({ code: "insert_failed" });
      return;
    }
    const created = getAppUserRoleById(id);
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "create",
      entityType: "app_user_role",
      entityId: id,
      summary: `Rôle applicatif créé : ${label}`,
    });
    res.status(201).json({ role: rowToApi(created!) });
  });

  r.patch("/:roleId", requireAuth, requireAnyPermission("admin.roles"), (req: AuthedRequest, res: Response) => {
    const roleId = typeof req.params.roleId === "string" ? req.params.roleId : req.params.roleId[0];
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const current = getAppUserRoleById(roleId);
    if (!current) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const body = parsed.data;
    const has =
      body.label !== undefined ||
      body.sortOrder !== undefined ||
      body.isAppAdmin !== undefined ||
      body.canManageAppUsers !== undefined ||
      body.allowNonAdminInvite !== undefined ||
      body.permissions !== undefined;
    if (!has) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    if (current.is_system === 1 && body.label !== undefined && body.label !== current.label) {
      res.status(403).json({ code: "system_role" });
      return;
    }

    let newLabel = current.label;
    if (body.label !== undefined && body.label !== current.label) {
      const taken = db.prepare("SELECT 1 AS x FROM app_user_roles WHERE label = ? COLLATE NOCASE AND id != ?").get(
        body.label,
        roleId,
      ) as { x: number } | undefined;
      if (taken) {
        res.status(409).json({ code: "label_taken" });
        return;
      }
      newLabel = body.label;
    }

    const nextIsAdmin =
      body.isAppAdmin !== undefined ? (body.isAppAdmin ? 1 : 0) : current.is_app_admin;
    if (current.is_app_admin === 1 && nextIsAdmin === 0 && countAppAdminRoleDefinitions() <= 1) {
      res.status(403).json({ code: "last_admin_role" });
      return;
    }

    const sets: string[] = [];
    const params: Record<string, string | number> = { id: roleId };

    if (body.label !== undefined) {
      sets.push("label = @label");
      params.label = newLabel;
    }
    if (body.sortOrder !== undefined) {
      sets.push("sort_order = @sort_order");
      params.sort_order = body.sortOrder;
    }
    if (body.isAppAdmin !== undefined) {
      sets.push("is_app_admin = @is_app_admin");
      params.is_app_admin = body.isAppAdmin ? 1 : 0;
    }
    if (body.canManageAppUsers !== undefined) {
      sets.push("can_manage_app_users = @can_manage_app_users");
      params.can_manage_app_users = body.canManageAppUsers ? 1 : 0;
    }
    if (body.allowNonAdminInvite !== undefined) {
      sets.push("allow_non_admin_invite = @allow_non_admin_invite");
      params.allow_non_admin_invite = body.allowNonAdminInvite ? 1 : 0;
    }

    try {
      db.transaction(() => {
        if (body.label !== undefined && newLabel !== current.label) {
          db.prepare("UPDATE users SET role = @newLabel WHERE lower(role) = lower(@oldLabel)").run({
            newLabel,
            oldLabel: current.label,
          });
          db.prepare(
            "UPDATE user_invitations SET role = @newLabel WHERE lower(role) = lower(@oldLabel) AND consumed_at IS NULL",
          ).run({
            newLabel,
            oldLabel: current.label,
          });
        }
        db.prepare(`UPDATE app_user_roles SET ${sets.join(", ")} WHERE id = @id`).run(params);

        const finalRow = getAppUserRoleById(roleId)!;
        const grantTouch =
          body.permissions !== undefined ||
          body.canManageAppUsers !== undefined ||
          body.isAppAdmin !== undefined;
        if (grantTouch) {
          if (finalRow.is_app_admin === 1) {
            clearStoredPermissionsForRole(roleId);
          } else if (body.permissions !== undefined) {
            replaceRolePermissions(roleId, body.permissions);
          } else if (body.canManageAppUsers === true) {
            replaceRolePermissions(roleId, [...LEGACY_MANAGE_USERS_PERMISSION_PRESET]);
          } else if (body.canManageAppUsers === false) {
            replaceRolePermissions(roleId, []);
          }
        }
        syncCanManageAppUsersColumn(roleId);
      })();
    } catch {
      res.status(500).json({ code: "update_failed" });
      return;
    }

    const updated = getAppUserRoleById(roleId)!;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "app_user_role",
      entityId: roleId,
      summary: `Rôle applicatif modifié : ${updated.label}`,
    });
    res.json({ role: rowToApi(updated) });
  });

  r.delete("/:roleId", requireAuth, requireAnyPermission("admin.roles"), (req: AuthedRequest, res: Response) => {
    const roleId = typeof req.params.roleId === "string" ? req.params.roleId : req.params.roleId[0];
    const current = getAppUserRoleById(roleId);
    if (!current) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    if (current.is_system === 1) {
      res.status(403).json({ code: "system_role" });
      return;
    }
    if (current.is_app_admin === 1 && countAppAdminRoleDefinitions() <= 1) {
      res.status(403).json({ code: "last_admin_role" });
      return;
    }
    const nUsers = countUsersWithRoleLabel(current.label);
    if (nUsers > 0) {
      res.status(409).json({ code: "role_in_use" });
      return;
    }
    const pendingInv = db
      .prepare(
        `SELECT COUNT(*) AS c FROM user_invitations WHERE role = ? COLLATE NOCASE AND consumed_at IS NULL`,
      )
      .get(current.label) as { c: number };
    if (pendingInv.c > 0) {
      res.status(409).json({ code: "pending_invites" });
      return;
    }
    db.prepare("DELETE FROM app_user_roles WHERE id = ?").run(roleId);
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "delete",
      entityType: "app_user_role",
      entityId: roleId,
      summary: `Effacement définitif — rôle applicatif supprimé : ${current.label}`,
    });
    res.status(204).end();
  });

  return r;
}
