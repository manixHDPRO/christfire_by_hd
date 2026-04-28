import type { CookieOptions, NextFunction, Request, Response } from "express";
import { COOKIE_NAME, signToken, verifyToken } from "../auth/jwt.js";
import { db } from "../db.js";
import { createUserSession, isSessionActive, touchSessionIfNeeded } from "../sessions.js";
import type { JwtPayload } from "../types.js";

export type AuthedRequest = Request & { auth?: JwtPayload };

export function readTokenFromCookie(req: Request): string | null {
  const raw = req.cookies?.[COOKIE_NAME];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function cookieOptions(): CookieOptions {
  const secure = process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "1";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
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
  if (payload.sid) {
    if (!isSessionActive(payload.sid, payload.sub)) {
      res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    touchSessionIfNeeded(payload.sid);
    req.auth = payload;
  } else {
    const { id: sid } = createUserSession(payload.sub, req);
    const upgraded: JwtPayload = { ...payload, sid };
    const newToken = signToken(upgraded, process.env.JWT_EXPIRES_IN ?? "8h");
    res.cookie(COOKIE_NAME, newToken, cookieOptions());
    req.auth = upgraded;
  }

  const live = db
    .prepare("SELECT role, active FROM users WHERE id = ?")
    .get(req.auth.sub) as { role: string; active: number } | undefined;
  if (!live || live.active !== 1) {
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  /** Droit et rôle effectifs depuis la BDD (JWT peut être ancien après changement de rôle ou de matrice). */
  req.auth = { ...req.auth, role: live.role as JwtPayload["role"] };

  next();
}
