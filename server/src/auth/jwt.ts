import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import type { JwtPayload, UserRole } from "../types.js";

const COOKIE_NAME = "hd_cf_at";

export function parseDurationSeconds(s: string): number {
  const t = s.trim();
  const m = /^(\d+)(s|m|h|d)$/i.exec(t);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u === "s") return n;
    if (u === "m") return n * 60;
    if (u === "h") return n * 3600;
    if (u === "d") return n * 86400;
  }
  return 8 * 3600;
}

const DEV_FALLBACK =
  "dev-only-jwt-secret-change-me-32chars-minimum-for-local-work-only!!";

/** Évite de relire l’env et de spammer la console à chaque sign/verify. */
let resolvedSecret: string | null = null;

function getSecret(): string {
  if (resolvedSecret !== null) return resolvedSecret;
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32) {
    resolvedSecret = s;
    return s;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET doit être défini et faire au moins 32 caractères en production.");
  }
  console.warn(
    "[hd-christfire] JWT_SECRET absent ou trop court — secret de développement utilisé (ne pas utiliser en production).",
  );
  resolvedSecret = DEV_FALLBACK;
  return DEV_FALLBACK;
}

export function signToken(payload: JwtPayload, expiresInRaw: string): string {
  const secret = getSecret() as Secret;
  const expiresIn = parseDurationSeconds(expiresInRaw);
  const options: SignOptions = { expiresIn, algorithm: "HS256" };
  return jwt.sign(payload, secret, options);
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const secret = getSecret() as Secret;
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded === "string" || !decoded || typeof decoded !== "object") return null;
    const o = decoded as Record<string, unknown>;
    if (
      typeof o.sub !== "string" ||
      typeof o.email !== "string" ||
      typeof o.name !== "string" ||
      typeof o.role !== "string"
    ) {
      return null;
    }
    const sid = typeof o.sid === "string" && o.sid.length > 0 ? o.sid : undefined;
    return {
      sub: o.sub,
      email: o.email,
      name: o.name,
      role: o.role as UserRole,
      ...(sid ? { sid } : {}),
    };
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
