import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import rateLimit from "express-rate-limit";
import { authenticator } from "otplib";
import { z } from "zod";
import { COOKIE_NAME, signToken, verifyToken } from "../auth/jwt.js";
import { authFlagsForRoleLabel, getAppUserRoleByLabel, isKnownRoleLabel } from "../appUserRoles.js";
import { recordAudit } from "../auditLog.js";
import { db } from "../db.js";
import { hashInviteToken } from "../inviteToken.js";
import { requireAuth, cookieOptions, readTokenFromCookie, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import {
  adminRevokeSession,
  createUserSession,
  isSessionActive,
  listAllActiveSessionsForAdmin,
  listSessionsForUser,
  revokeOtherSessions,
  revokeSession,
  touchSessionIfNeeded,
} from "../sessions.js";
import type { JwtPayload } from "../types.js";

authenticator.options = { window: 1 };

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(256),
  totpCode: z.string().trim().max(16).optional(),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "invalid_credentials" },
});

const invitePreviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
});

const acceptInviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
});

const BCRYPT_ROUNDS = 12;

const acceptInviteSchema = z.object({
  token: z.string().min(20).max(512),
  password: z.string().min(8).max(256),
});

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  active: number;
  last_login_at?: string | null;
  totp_enabled?: number | null;
  totp_secret?: string | null;
  totp_pending_secret?: string | null;
};

function sessionUserFields(row: UserRow): {
  id: string;
  name: string;
  email: string;
  role: string;
  isAppAdmin: boolean;
  canManageAppUsers: boolean;
  permissions: string[];
  lastLoginAt: string | null;
  totpEnabled: boolean;
} {
  const caps = authFlagsForRoleLabel(row.role);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isAppAdmin: caps.isAppAdmin,
    canManageAppUsers: caps.canManageAppUsers,
    permissions: caps.permissions,
    lastLoginAt: row.last_login_at ?? null,
    totpEnabled: (row.totp_enabled ?? 0) === 1,
  };
}

function normalizeTotpInput(raw: string | undefined): string {
  return (raw ?? "").replace(/\s/g, "");
}

function issueAuthCookie(res: Response, req: Request, row: UserRow): void {
  const { id: sid } = createUserSession(row.id, req);
  const payload: JwtPayload = {
    sub: row.id,
    email: row.email,
    name: row.name,
    role: row.role as JwtPayload["role"],
    sid,
  };
  const token = signToken(payload, process.env.JWT_EXPIRES_IN ?? "8h");
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

export function authRoutes(): Router {
  const r = createRouter();

  r.post("/login", loginLimiter, (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_credentials" });
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();
    const totpNorm = normalizeTotpInput(parsed.data.totpCode);

    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
    if (!row) {
      res.status(401).json({ code: "invalid_credentials" });
      return;
    }
    if (!row.active) {
      res.status(401).json({ code: "inactive" });
      return;
    }
    const ok = bcrypt.compareSync(parsed.data.password, row.password_hash);
    if (!ok) {
      res.status(401).json({ code: "invalid_credentials" });
      return;
    }

    const has2fa = (row.totp_enabled ?? 0) === 1 && row.totp_secret != null && row.totp_secret.length > 0;
    if (has2fa) {
      if (!totpNorm) {
        res.status(403).json({ code: "2fa_required" });
        return;
      }
      if (!authenticator.check(totpNorm, row.totp_secret!)) {
        res.status(401).json({ code: "invalid_totp" });
        return;
      }
    }

    db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(row.id);
    const refreshed = db.prepare("SELECT * FROM users WHERE id = ?").get(row.id) as UserRow;
    issueAuthCookie(res, req, refreshed);
    res.json({ user: sessionUserFields(refreshed) });
  });

  r.post("/logout", (req: Request, res: Response) => {
    const token = readTokenFromCookie(req);
    if (token) {
      const payload = verifyToken(token);
      if (payload?.sid) {
        revokeSession(payload.sid, payload.sub);
      }
    }
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
    res.status(204).end();
  });

  r.get("/me", (req: Request, res: Response) => {
    const token = readTokenFromCookie(req);
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (payload.sid && !isSessionActive(payload.sid, payload.sub)) {
      res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub) as UserRow | undefined;
    if (!row || !row.active) {
      res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!payload.sid) {
      const { id: sid } = createUserSession(row.id, req);
      const upgraded: JwtPayload = {
        sub: row.id,
        email: row.email,
        name: row.name,
        role: row.role as JwtPayload["role"],
        sid,
      };
      const newToken = signToken(upgraded, process.env.JWT_EXPIRES_IN ?? "8h");
      res.cookie(COOKIE_NAME, newToken, cookieOptions());
    } else {
      touchSessionIfNeeded(payload.sid);
    }
    res.json({ user: sessionUserFields(row) });
  });

  r.get("/sessions", requireAuth, (req: AuthedRequest, res: Response) => {
    const auth = req.auth!;
    const rows = listSessionsForUser(auth.sub);
    const now = Date.now();
    res.json({
      sessions: rows.map((s) => ({
        id: s.id,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        expiresAt: s.expires_at,
        userAgent: s.user_agent,
        ip: s.ip,
        isCurrent: auth.sid === s.id,
      })),
      serverTime: now,
    });
  });

  r.delete("/sessions/:sessionId", requireAuth, (req: AuthedRequest, res: Response) => {
    const auth = req.auth!;
    const sessionId = typeof req.params.sessionId === "string" ? req.params.sessionId.trim() : "";
    if (!sessionId) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const ok = revokeSession(sessionId, auth.sub);
    if (!ok) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    if (auth.sid === sessionId) {
      res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
    }
    recordAudit({
      actorUserId: auth.sub,
      action: "update",
      entityType: "session",
      entityId: sessionId,
      summary: "Session révoquée",
    });
    res.status(204).end();
  });

  r.post("/sessions/revoke-others", requireAuth, (req: AuthedRequest, res: Response) => {
    const auth = req.auth!;
    if (!auth.sid) {
      res.status(400).json({ code: "no_session" });
      return;
    }
    const n = revokeOtherSessions(auth.sub, auth.sid);
    recordAudit({
      actorUserId: auth.sub,
      action: "update",
      entityType: "user",
      entityId: auth.sub,
      summary: `Révocation de ${n} autre(s) session(s) active(s)`,
    });
    res.json({ revoked: n });
  });

  const setupVerifySchema = z.object({
    code: z.string().trim().min(4).max(16),
  });

  const disable2faSchema = z.object({
    password: z.string().min(1).max(256),
    totpCode: z.string().trim().max(16).optional(),
  });

  r.post("/2fa/setup-start", requireAuth, (req: AuthedRequest, res: Response) => {
    const auth = req.auth!;
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(auth.sub) as UserRow | undefined;
    if (!row) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    if ((row.totp_enabled ?? 0) === 1) {
      res.status(400).json({ code: "2fa_already_enabled" });
      return;
    }
    const secret = authenticator.generateSecret();
    db.prepare(`UPDATE users SET totp_pending_secret = ?, updated_at = datetime('now') WHERE id = ?`).run(
      secret,
      auth.sub,
    );
    const otpauthUrl = authenticator.keyuri(row.email, "HD ChristFire", secret);
    res.json({ secret, otpauthUrl });
  });

  r.post("/2fa/setup-verify", requireAuth, (req: AuthedRequest, res: Response) => {
    const parsed = setupVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const auth = req.auth!;
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(auth.sub) as UserRow | undefined;
    if (!row?.totp_pending_secret) {
      res.status(400).json({ code: "no_pending_2fa" });
      return;
    }
    const code = normalizeTotpInput(parsed.data.code);
    if (!authenticator.check(code, row.totp_pending_secret)) {
      res.status(400).json({ code: "invalid_totp" });
      return;
    }
    db.prepare(
      `UPDATE users SET totp_secret = totp_pending_secret, totp_enabled = 1, totp_pending_secret = NULL,
 updated_at = datetime('now') WHERE id = ?`,
    ).run(auth.sub);
    recordAudit({
      actorUserId: auth.sub,
      action: "update",
      entityType: "user",
      entityId: auth.sub,
      summary: "Double authentification (2FA) activée",
    });
    const refreshed = db.prepare("SELECT * FROM users WHERE id = ?").get(auth.sub) as UserRow;
    res.json({ user: sessionUserFields(refreshed) });
  });

  r.post("/2fa/setup-cancel", requireAuth, (req: AuthedRequest, res: Response) => {
    const auth = req.auth!;
    db.prepare(`UPDATE users SET totp_pending_secret = NULL, updated_at = datetime('now') WHERE id = ?`).run(
      auth.sub,
    );
    res.status(204).end();
  });

  r.post("/2fa/disable", requireAuth, (req: AuthedRequest, res: Response) => {
    const parsed = disable2faSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const auth = req.auth!;
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(auth.sub) as UserRow | undefined;
    if (!row || (row.totp_enabled ?? 0) !== 1 || !row.totp_secret) {
      res.status(400).json({ code: "2fa_not_enabled" });
      return;
    }
    if (!bcrypt.compareSync(parsed.data.password, row.password_hash)) {
      res.status(401).json({ code: "invalid_credentials" });
      return;
    }
    const totpNorm = normalizeTotpInput(parsed.data.totpCode);
    if (!authenticator.check(totpNorm, row.totp_secret)) {
      res.status(401).json({ code: "invalid_totp" });
      return;
    }
    db.prepare(
      `UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_pending_secret = NULL, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(auth.sub);
    recordAudit({
      actorUserId: auth.sub,
      action: "update",
      entityType: "user",
      entityId: auth.sub,
      summary: "Double authentification (2FA) désactivée",
    });
    const refreshed = db.prepare("SELECT * FROM users WHERE id = ?").get(auth.sub) as UserRow;
    res.json({ user: sessionUserFields(refreshed) });
  });

  r.get("/invite-preview", invitePreviewLimiter, (req: Request, res: Response) => {
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (token.length < 20) {
      res.status(400).json({ code: "invalid_token" });
      return;
    }
    const tokenHash = hashInviteToken(token);
    type InvitePreviewRow = {
      email: string;
      name: string;
      role: string;
      expiresAt: string;
      consumedAt: string | null;
    };
    const row = db
      .prepare(
        `SELECT email, name, role, expires_at AS expiresAt, consumed_at AS consumedAt
         FROM user_invitations WHERE token_hash = ?`,
      )
      .get(tokenHash) as InvitePreviewRow | undefined;
    if (!row || row.consumedAt) {
      res.status(404).json({ code: "invite_not_found" });
      return;
    }
    const now = Date.now();
    const exp = Date.parse(row.expiresAt);
    if (!Number.isFinite(exp) || exp < now) {
      res.status(410).json({ code: "invite_expired" });
      return;
    }
    res.json({
      email: row.email,
      name: row.name,
      role: row.role,
      expiresAt: row.expiresAt,
    });
  });

  r.post("/accept-invite", acceptInviteLimiter, (req: Request, res: Response) => {
    const parsed = acceptInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const { token, password } = parsed.data;
    const tokenHash = hashInviteToken(token);

    type InviteRow = {
      id: string;
      email: string;
      name: string;
      role: string;
      active: number;
      expires_at: string;
      consumed_at: string | null;
    };

    let created: UserRow | undefined;
    try {
      db.transaction(() => {
        const inv = db
          .prepare(
            `SELECT id, email, name, role, active, expires_at, consumed_at
             FROM user_invitations WHERE token_hash = ?`,
          )
          .get(tokenHash) as InviteRow | undefined;
        if (!inv || inv.consumed_at) {
          throw new Error("not_found");
        }
        const exp = Date.parse(inv.expires_at);
        if (!Number.isFinite(exp) || exp < Date.now()) {
          throw new Error("expired");
        }
        const email = inv.email.trim().toLowerCase();
        const exists = db.prepare("SELECT 1 AS x FROM users WHERE email = ?").get(email) as { x: number } | undefined;
        if (exists) {
          throw new Error("email_taken");
        }
        if (!isKnownRoleLabel(inv.role)) {
          throw new Error("invalid_role");
        }
        const roleLabel = getAppUserRoleByLabel(inv.role)!.label;
        const userId = randomUUID();
        const password_hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
        db.prepare(
          `INSERT INTO users (id, email, password_hash, name, role, active, created_at, updated_at)
           VALUES (@id, @email, @password_hash, @name, @role, @active, datetime('now'), datetime('now'))`,
        ).run({
          id: userId,
          email,
          password_hash,
          name: inv.name,
          role: roleLabel,
          active: inv.active,
        });
        db.prepare("UPDATE user_invitations SET consumed_at = datetime('now') WHERE id = ?").run(inv.id);
        created = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
      })();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "not_found") {
        res.status(404).json({ code: "invite_not_found" });
        return;
      }
      if (msg === "expired") {
        res.status(410).json({ code: "invite_expired" });
        return;
      }
      if (msg === "email_taken") {
        res.status(409).json({ code: "email_taken" });
        return;
      }
      if (msg === "invalid_role") {
        res.status(400).json({ code: "invalid_role" });
        return;
      }
      res.status(500).json({ code: "error" });
      return;
    }

    if (!created) {
      res.status(500).json({ code: "error" });
      return;
    }

    db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(created.id);
    const refreshed = db.prepare("SELECT * FROM users WHERE id = ?").get(created.id) as UserRow;
    issueAuthCookie(res, req, refreshed);

    recordAudit({
      actorUserId: null,
      action: "create",
      entityType: "user",
      entityId: created.id,
      summary: `Compte activé via invitation : ${created.name} (${created.email})`,
    });

    res.status(201).json({ user: sessionUserFields(refreshed) });
  });

  r.get("/admin/sessions", requireAuth, requireAnyPermission("admin.sessions"), (_req: AuthedRequest, res: Response) => {
    const rows = listAllActiveSessionsForAdmin();
    res.json({
      sessions: rows.map((s) => ({
        id: s.id,
        userId: s.user_id,
        userName: s.user_name,
        userEmail: s.user_email,
        userRole: s.user_role,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        expiresAt: s.expires_at,
        userAgent: s.user_agent,
        ip: s.ip,
      })),
    });
  });

  r.delete(
    "/admin/sessions/:sessionId",
    requireAuth,
    requireAnyPermission("admin.sessions"),
    (req: AuthedRequest, res: Response) => {
    const auth = req.auth!;
    const sessionId = typeof req.params.sessionId === "string" ? req.params.sessionId.trim() : "";
    if (!sessionId) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const out = adminRevokeSession(sessionId);
    if (!out.ok) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    recordAudit({
      actorUserId: auth.sub,
      action: "update",
      entityType: "session",
      entityId: sessionId,
      summary: `Session révoquée par un administrateur (${out.userEmail ?? out.userId ?? "?"})`,
    });
    res.status(204).end();
  });

  return r;
}
