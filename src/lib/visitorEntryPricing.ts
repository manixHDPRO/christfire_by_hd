/** Total droit d’entrée (USD entiers) pour un groupe / famille à partir des tarifs paramétrés. */
export function visitorFamilyGroupEntryUsd(
  adults: number,
  minors: number,
  adultUsdPerPerson: number,
  minorUsdPerPerson: number,
): number {
  const a = Math.max(0, Math.floor(adults));
  const m = Math.max(0, Math.floor(minors));
  const pa = Math.max(0, Math.floor(adultUsdPerPerson));
  const pm = Math.max(0, Math.floor(minorUsdPerPerson));
  return a * pa + m * pm;
}
