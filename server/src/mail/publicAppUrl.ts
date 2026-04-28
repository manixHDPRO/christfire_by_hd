import type { Request } from "express";

/**
 * URL publique de l’app (sans slash final), pour les liens dans les e-mails.
 * Priorité : APP_PUBLIC_URL, puis en-tête Origin, puis hôte de la requête.
 */
export function resolvePublicAppUrl(req: Request): string | null {
  const fromEnv = process.env.APP_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  const origin = req.get("origin")?.trim();
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, "");

  const xfProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = xfProto && xfProto.length > 0 ? xfProto : req.protocol;
  const xfHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = (xfHost && xfHost.length > 0 ? xfHost : req.get("host"))?.trim();
  if (host) return `${proto}://${host}`.replace(/\/$/, "");

  return null;
}
