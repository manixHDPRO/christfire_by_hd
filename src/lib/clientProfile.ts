import type { ClientProfileType } from "@/types";

/** Domaine des e-mails techniques générés quand un profil à e-mail facultatif n’a pas d’adresse (unicité en base). */
export const CLIENT_SENTINEL_EMAIL_DOMAIN = "sans-email.christfire";

export const CLIENT_PROFILE_LABELS: Record<string, string> = {
  hebergement: "Hébergement",
  passage: "Passage",
  mixte: "Mixte",
};

export const CLIENT_PROFILE_HINTS: Record<string, string> = {
  hebergement: "Séjour au lodge : réservations, facturation classique.",
  passage: "Visite ou achat ponctuel (ex. buvette) : e-mail facultatif.",
  mixte: "À la fois séjours et visites / achats sur place.",
};

const PROFILE_BADGE_LEGACY: Record<string, string> = {
  hebergement: "border-emerald-400/25 bg-emerald-500/10 text-emerald-100/90",
  passage: "border-white/20 bg-white/[0.06] text-white/75",
  mixte: "border-brand-orange/30 bg-brand-orange/10 text-brand-cream",
};

const BADGE_ROTATION = [
  "border-violet-400/25 bg-violet-500/10 text-violet-100/90",
  "border-cyan-400/25 bg-cyan-500/10 text-cyan-100/90",
  "border-amber-400/25 bg-amber-500/10 text-amber-100/90",
  "border-sky-400/25 bg-sky-500/10 text-sky-100/90",
] as const;

/** Valeur à proposer dans les champs « droit d’entrée » selon le prix de référence (Paramètres → Tarification). */
export function suggestedEntryFeeUsdString(
  code: string,
  types: ClientProfileType[],
  referencePriceUsd: number,
): string {
  const p = types.find((t) => t.code === code);
  if (!p?.appliesEntryFee) return "";
  const d = Math.floor(referencePriceUsd);
  return d >= 1 ? String(d) : "";
}

export function clientProfileLabel(code: string, types: ClientProfileType[]): string {
  const fromApi = types.find((t) => t.code === code);
  if (fromApi) return fromApi.label;
  return CLIENT_PROFILE_LABELS[code] ?? code;
}

export function clientProfileHint(code: string, types: ClientProfileType[]): string {
  const fromApi = types.find((t) => t.code === code);
  if (fromApi?.hint.trim()) return fromApi.hint;
  return CLIENT_PROFILE_HINTS[code] ?? "";
}

export function profileBadgeClass(code: string): string {
  const legacy = PROFILE_BADGE_LEGACY[code];
  if (legacy) return legacy;
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return BADGE_ROTATION[h % BADGE_ROTATION.length]!;
}

export function isProfileEmailOptional(code: string, types: ClientProfileType[]): boolean {
  return types.some((t) => t.code === code && t.emailOptional);
}

export function profileAppliesEntryFee(code: string, types: ClientProfileType[]): boolean {
  return types.some((t) => t.code === code && t.appliesEntryFee);
}

export function isSentinelClientEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${CLIENT_SENTINEL_EMAIL_DOMAIN}`);
}

/** Affichage lisible (masque l’e-mail technique interne). */
export function displayClientEmail(email: string): string {
  return isSentinelClientEmail(email) ? "Non renseigné" : email;
}
