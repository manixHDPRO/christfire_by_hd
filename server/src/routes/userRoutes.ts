import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import {
  countActiveUsersWithAppAdminRole,
  countUsersWithAppAdminRole,
  getAppUserRoleByLabel,
  isKnownRoleLabel,
} from "../appUserRoles.js";
import { recordAudit } from "../auditLog.js";
import { db } from "../db.js";
import { hardDeleteUser } from "../hardDelete.js";
import { hashInviteToken } from "../inviteToken.js";
import { buildInvitationAcceptUrl } from "../mail/inviteLink.js";
import { resolvePublicAppUrl } from "../mail/publicAppUrl.js";
import { isInvitationMailConfigured, sendInvitationMail } from "../mail/sendInvitationMail.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { roleHasPermission } from "../permissions.js";
import type { PublicUser, UserRole } from "../types.js";

const BCRYPT_ROUNDS = 12;

const roleLabelSchema = z.string().trim().min(1).max(80);

const createUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(256),
  name: z.string().min(1).max(120).trim(),
  role: roleLabelSchema,
  active: z.boolean().optional().default(true),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  email: z.string().email().max(255).optional(),
  role: roleLabelSchema.optional(),
  active: z.boolean().optional(),
  /** Vide ou absent = ne pas changer le mot de passe */
  password: z.union([z.string().min(8).max(256), z.literal("")]).optional(),
  /** Remplace la liste des caisses comptoir assignées (droit caisse comptoir). */
  pointOfSaleIds: z.array(z.string().min(1).max(80)).max(50).optional(),
});

const createInvitationSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(120).trim(),
  role: roleLabelSchema,
  active: z.boolean().optional().default(true),
});

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: number;
  created_at?: string | null;
  updated_at?: string | null;
  last_login_at?: string | null;
  totp_enabled?: number | null;
};

function rowToPublic(row: UserRow, pointOfSaleIds?: string[]): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as UserRole,
    active: row.active === 1,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? row.created_at ?? "",
    lastLoginAt: row.last_login_at ?? null,
    totpEnabled: (row.totp_enabled ?? 0) === 1,
    ...(pointOfSaleIds !== undefined ? { pointOfSaleIds } : {}),
  };
}

export function userRoutes(): Router {
  const r = createRouter();

  r.get("/", requireAuth, (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.active, u.created_at, u.updated_at, u.last_login_at, u.totp_enabled,
                GROUP_CONCAT(j.point_of_sale_id) AS pos_csv
         FROM users u
         LEFT JOIN app_user_point_of_sale j ON j.user_id = u.id
         GROUP BY u.id
         ORDER BY u.email ASC`,
      )
      .all() as (UserRow & { pos_csv: string | null })[];
    const users: PublicUser[] = rows.map((row) => {
      const { pos_csv, ...u } = row;
      const pointOfSaleIds = pos_csv
        ? [...new Set(pos_csv.split(",").filter(Boolean))].sort()
        : [];
      return rowToPublic(u, pointOfSaleIds);
    });
    res.json({ users });
  });

  r.get("/invitations", requireAuth, requireAnyPermission("users.invite"), (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT id, email, name, role, active, expires_at AS expiresAt, created_at AS createdAt
         FROM user_invitations
         WHERE consumed_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all() as { id: string; email: string; name: string; role: string; active: number; expiresAt: string; createdAt: string }[];
    res.json({
      invitations: rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        active: row.active === 1,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      })),
    });
  });

  r.post("/invitations", requireAuth, requireAnyPermission("users.invite"), async (req: AuthedRequest, res: Response) => {
    const parsed = createInvitationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    if (!isKnownRoleLabel(parsed.data.role)) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const auth = req.auth!;
    const inviteRoleDef = getAppUserRoleByLabel(parsed.data.role)!;
    if (
      !roleHasPermission(auth.role, "users.invite_unrestricted") &&
      inviteRoleDef.allow_non_admin_invite !== 1
    ) {
      res.status(403).json({ code: "forbidden_role_assignment" });
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();
    const taken = db.prepare("SELECT 1 AS x FROM users WHERE email = ?").get(email) as { x: number } | undefined;
    if (taken) {
      res.status(409).json({ code: "email_taken" });
      return;
    }

    if (!isInvitationMailConfigured()) {
      res.status(503).json({ code: "email_not_configured" });
      return;
    }

    const publicOrigin = resolvePublicAppUrl(req);
    if (!publicOrigin) {
      res.status(400).json({ code: "public_url_required" });
      return;
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashInviteToken(rawToken);
    const id = randomUUID();
    const daysRaw = Number(process.env.INVITE_EXPIRES_DAYS ?? 7);
    const days = Number.isFinite(daysRaw) ? Math.min(30, Math.max(1, daysRaw)) : 7;
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + days);
    const expiresIso = expiresAt.toISOString();

    try {
      db.transaction(() => {
        db.prepare("DELETE FROM user_invitations WHERE lower(email) = lower(?) AND consumed_at IS NULL").run(email);
        db.prepare(
          `INSERT INTO user_invitations (id, email, token_hash, name, role, active, expires_at, created_by_user_id)
           VALUES (@id, @email, @token_hash, @name, @role, @active, @expires_at, @created_by_user_id)`,
        ).run({
          id,
          email,
          token_hash: tokenHash,
          name: parsed.data.name,
          role: inviteRoleDef.label,
          active: parsed.data.active ? 1 : 0,
          expires_at: expiresIso,
          created_by_user_id: auth.sub,
        });
      })();
    } catch {
      res.status(500).json({ code: "insert_failed" });
      return;
    }

    const inviteUrl = buildInvitationAcceptUrl(publicOrigin, rawToken);
    const expiresAtLabel = expiresAt.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });
    const sent = await sendInvitationMail({
      to: email,
      inviteeName: parsed.data.name,
      inviteUrl,
      expiresAtLabel,
      roleLabel: inviteRoleDef.label,
    });

    if (!sent.ok) {
      db.prepare("DELETE FROM user_invitations WHERE id = ?").run(id);
      if (sent.code === "not_configured") {
        res.status(503).json({ code: "email_not_configured" });
        return;
      }
      console.error("[invitation-mail]", sent.detail ?? "send_failed");
      res.status(502).json({ code: "email_send_failed" });
      return;
    }

    recordAudit({
      actorUserId: auth.sub,
      action: "create",
      entityType: "user_invitation",
      entityId: id,
      summary: `Invitation envoyée : ${email} — ${inviteRoleDef.label}`,
    });
    res.status(201).json({
      emailSent: true,
      expiresAt: expiresIso,
      invitee: {
        email,
        name: parsed.data.name,
        role: inviteRoleDef.label,
        active: parsed.data.active,
      },
    });
  });

  r.delete("/invitations/:inviteId", requireAuth, requireAnyPermission("users.invite"), (req: AuthedRequest, res: Response) => {
    const inviteId = typeof req.params.inviteId === "string" ? req.params.inviteId : req.params.inviteId[0];
    const inv = db
      .prepare("SELECT email, name FROM user_invitations WHERE id = ? AND consumed_at IS NULL")
      .get(inviteId) as { email: string; name: string } | undefined;
    const rDel = db
      .prepare("DELETE FROM user_invitations WHERE id = ? AND consumed_at IS NULL")
      .run(inviteId);
    if (rDel.changes === 0) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    if (inv) {
      recordAudit({
        actorUserId: req.auth?.sub ?? null,
        action: "delete",
        entityType: "user_invitation",
        entityId: inviteId,
        summary: `Invitation révoquée : ${inv.email} (${inv.name})`,
      });
    }
    res.status(204).end();
  });

  r.post("/", requireAuth, requireAnyPermission("users.create"), (req: AuthedRequest, res: Response) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    if (!isKnownRoleLabel(parsed.data.role)) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const roleLabel = getAppUserRoleByLabel(parsed.data.role)!.label;
    const email = parsed.data.email.trim().toLowerCase();
    const taken = db.prepare("SELECT 1 AS x FROM users WHERE email = ?").get(email) as { x: number } | undefined;
    if (taken) {
      res.status(409).json({ code: "email_taken" });
      return;
    }

    const id = randomUUID();
    const password_hash = bcrypt.hashSync(parsed.data.password, BCRYPT_ROUNDS);
    try {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, name, role, active, created_at, updated_at)
         VALUES (@id, @email, @password_hash, @name, @role, @active, datetime('now'), datetime('now'))`,
      ).run({
        id,
        email,
        password_hash,
        name: parsed.data.name,
        role: roleLabel,
        active: parsed.data.active ? 1 : 0,
      });
    } catch {
      res.status(500).json({ code: "insert_failed" });
      return;
    }

    const row = db
      .prepare(
        "SELECT id, email, name, role, active, created_at, updated_at, last_login_at, totp_enabled FROM users WHERE id = ?",
      )
      .get(id) as UserRow;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "create",
      entityType: "user",
      entityId: id,
      summary: `Utilisateur créé : ${parsed.data.name} (${email}) — ${roleLabel}`,
    });
    res.status(201).json({ user: rowToPublic(row, []) });
  });

  r.patch("/:id", requireAuth, requireAnyPermission("users.manage"), (req: AuthedRequest, res: Response) => {
    const auth = (req as AuthedRequest).auth!;
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const body = parsed.data;
    const hasField =
      body.name !== undefined ||
      body.email !== undefined ||
      body.role !== undefined ||
      body.active !== undefined ||
      (body.password !== undefined && body.password.length > 0) ||
      body.pointOfSaleIds !== undefined;
    if (!hasField) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    if (body.role !== undefined) {
      if (!isKnownRoleLabel(body.role)) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      if (!roleHasPermission(auth.role, "users.assign_role")) {
        res.status(403).json({ code: "forbidden_role_assignment" });
        return;
      }
    }

    const target = db
      .prepare(
        "SELECT id, email, name, role, active, created_at, updated_at, last_login_at, totp_enabled FROM users WHERE id = ?",
      )
      .get(id) as UserRow | undefined;
    if (!target) {
      res.status(404).json({ code: "not_found" });
      return;
    }

    if (body.active === false && id === auth.sub) {
      res.status(403).json({ code: "cannot_deactivate_self" });
      return;
    }

    const targetDef = getAppUserRoleByLabel(target.role);
    const targetWasAdmin = targetDef?.is_app_admin === 1;

    if (body.role !== undefined) {
      const newDef = getAppUserRoleByLabel(body.role)!;
      const newIsAdmin = newDef.is_app_admin === 1;
      if (targetWasAdmin && !newIsAdmin && countUsersWithAppAdminRole() <= 1) {
        res.status(403).json({ code: "last_admin" });
        return;
      }
    }

    if (body.active === false && targetWasAdmin && target.active === 1) {
      if (countActiveUsersWithAppAdminRole() <= 1) {
        res.status(403).json({ code: "last_admin" });
        return;
      }
    }

    let emailToSet: string | undefined;
    if (body.email !== undefined) {
      const normalized = body.email.trim().toLowerCase();
      if (normalized !== target.email.toLowerCase()) {
        const taken = db
          .prepare("SELECT 1 AS x FROM users WHERE lower(email) = lower(?) AND id != ?")
          .get(normalized, id) as { x: number } | undefined;
        if (taken) {
          res.status(409).json({ code: "email_taken" });
          return;
        }
        emailToSet = normalized;
      }
    }

    const sets: string[] = [];
    const params: Record<string, string | number> = { id };

    if (body.name !== undefined) {
      sets.push("name = @name");
      params.name = body.name;
    }
    if (emailToSet !== undefined) {
      sets.push("email = @email");
      params.email = emailToSet;
    }
    if (body.role !== undefined) {
      sets.push("role = @role");
      params.role = getAppUserRoleByLabel(body.role)!.label;
    }
    if (body.active !== undefined) {
      sets.push("active = @active");
      params.active = body.active ? 1 : 0;
    }
    if (body.password !== undefined && body.password.length > 0) {
      sets.push("password_hash = @password_hash");
      params.password_hash = bcrypt.hashSync(body.password, BCRYPT_ROUNDS);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      try {
        db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = @id`).run(params);
      } catch {
        res.status(500).json({ code: "update_failed" });
        return;
      }
    } else if (body.pointOfSaleIds === undefined) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    if (body.pointOfSaleIds !== undefined) {
      const uniq = [...new Set(body.pointOfSaleIds)];
      for (const pid of uniq) {
        const ok = db.prepare(`SELECT 1 AS x FROM stock_points_of_sale WHERE id = ?`).get(pid) as
          | { x: number }
          | undefined;
        if (!ok) {
          res.status(400).json({ code: "unknown_point_of_sale" });
          return;
        }
      }
      try {
        const run = db.transaction(() => {
          db.prepare(`DELETE FROM app_user_point_of_sale WHERE user_id = ?`).run(id);
          const ins = db.prepare(
            `INSERT INTO app_user_point_of_sale (user_id, point_of_sale_id) VALUES (?, ?)`,
          );
          for (const pid of uniq) {
            ins.run(id, pid);
          }
        });
        run();
      } catch {
        res.status(500).json({ code: "update_failed" });
        return;
      }
    }

    const row = db
      .prepare(
        "SELECT id, email, name, role, active, created_at, updated_at, last_login_at, totp_enabled FROM users WHERE id = ?",
      )
      .get(id) as UserRow;
    const posRows = db
      .prepare(
        `SELECT point_of_sale_id FROM app_user_point_of_sale WHERE user_id = ? ORDER BY point_of_sale_id ASC`,
      )
      .all(id) as { point_of_sale_id: string }[];
    const pointOfSaleIds = posRows.map((r) => r.point_of_sale_id);
    recordAudit({
      actorUserId: auth.sub,
      action: "update",
      entityType: "user",
      entityId: id,
      summary: `Utilisateur modifié : ${row.name} (${row.email})`,
    });
    res.json({ user: rowToPublic(row, pointOfSaleIds) });
  });

  r.delete("/:id", requireAuth, requireAnyPermission("users.manage"), (req: AuthedRequest, res: Response) => {
    const auth = (req as AuthedRequest).auth!;
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];

    if (id === auth.sub) {
      res.status(403).json({ code: "cannot_delete_self" });
      return;
    }

    const result = hardDeleteUser(id);
    if (!result.ok) {
      if (result.code === "not_found") {
        res.status(404).json({ code: "not_found" });
        return;
      }
      res.status(403).json({ code: "last_admin" });
      return;
    }
    recordAudit({
      actorUserId: auth.sub,
      action: "delete",
      entityType: "user",
      entityId: id,
      summary: `Utilisateur supprimé (effacement définitif) : ${result.deleted.name} (${result.deleted.email})`,
    });
    res.status(204).end();
  });

  return r;
}
