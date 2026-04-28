import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { parseDurationSeconds } from "./auth/jwt.js";
import { db } from "./db.js";

const TOUCH_MS = 60_000;
const lastTouch = new Map<string, number>();

export type UserSessionRow = {
  id: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  user_agent: string;
  ip: string;
};

function clientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) return xf.split(",")[0]!.trim().slice(0, 128);
  return (req.socket.remoteAddress ?? "").slice(0, 128);
}

function userAgent(req: Request): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 512) : "";
}

export function jwtExpirySeconds(): number {
  return parseDurationSeconds(process.env.JWT_EXPIRES_IN ?? "8h");
}

export function createUserSession(userId: string, req: Request): { id: string } {
  const id = randomUUID();
  const sec = jwtExpirySeconds();
  const expMs = Date.now() + sec * 1000;
  const expiresAt = new Date(expMs).toISOString();
  db.prepare(
    `INSERT INTO user_sessions (id, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip)
     VALUES (@id, @user_id, datetime('now'), datetime('now'), @expires_at, NULL, @user_agent, @ip)`,
  ).run({
    id,
    user_id: userId,
    expires_at: expiresAt,
    user_agent: userAgent(req),
    ip: clientIp(req),
  });
  return { id };
}

export function isSessionActive(sid: string, userId: string): boolean {
  const row = db
    .prepare(
      `SELECT id FROM user_sessions
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND datetime(expires_at) > datetime('now')`,
    )
    .get(sid, userId) as { id: string } | undefined;
  return row != null;
}

export function touchSessionIfNeeded(sid: string): void {
  const now = Date.now();
  const prev = lastTouch.get(sid) ?? 0;
  if (now - prev < TOUCH_MS) return;
  lastTouch.set(sid, now);
  db.prepare(`UPDATE user_sessions SET last_seen_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`).run(sid);
}

export function revokeSession(sid: string, userId: string): boolean {
  const r = db
    .prepare(
      `UPDATE user_sessions SET revoked_at = datetime('now')
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(sid, userId);
  lastTouch.delete(sid);
  return r.changes > 0;
}

export function revokeOtherSessions(userId: string, exceptSid: string): number {
  const r = db
    .prepare(
      `UPDATE user_sessions SET revoked_at = datetime('now')
       WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
    )
    .run(userId, exceptSid);
  return r.changes;
}

export function listSessionsForUser(userId: string): UserSessionRow[] {
  return db
    .prepare(
      `SELECT id, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip
       FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL AND datetime(expires_at) > datetime('now')
       ORDER BY last_seen_at DESC`,
    )
    .all(userId) as UserSessionRow[];
}

/** Toutes les sessions non expirées (vue administrateur). */
export type AdminSessionRow = UserSessionRow & {
  user_name: string;
  user_email: string;
  user_role: string;
};

export function listAllActiveSessionsForAdmin(): AdminSessionRow[] {
  return db
    .prepare(
      `SELECT s.id, s.user_id, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at, s.user_agent, s.ip,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM user_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.revoked_at IS NULL AND datetime(s.expires_at) > datetime('now')
       ORDER BY s.last_seen_at DESC`,
    )
    .all() as AdminSessionRow[];
}

/** Révocation par un administrateur (tous comptes). */
export function adminRevokeSession(sessionId: string): {
  ok: boolean;
  userId?: string;
  userEmail?: string;
} {
  const row = db
    .prepare(
      `SELECT s.user_id AS user_id, u.email AS email
       FROM user_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL`,
    )
    .get(sessionId) as { user_id: string; email: string } | undefined;
  if (!row) return { ok: false };
  db.prepare(`UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ?`).run(sessionId);
  lastTouch.delete(sessionId);
  return { ok: true, userId: row.user_id, userEmail: row.email };
}
