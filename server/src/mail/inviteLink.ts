function pathPrefix(): string {
  let p = (process.env.APP_PATH_PREFIX ?? "").trim();
  if (!p) return "";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/$/, "");
}

/** Lien absolu vers la page d’acceptation d’invitation. */
export function buildInvitationAcceptUrl(publicOrigin: string, token: string): string {
  const base = publicOrigin.replace(/\/$/, "");
  const prefix = pathPrefix();
  return `${base}${prefix}/accepter-invitation?token=${encodeURIComponent(token)}`;
}
