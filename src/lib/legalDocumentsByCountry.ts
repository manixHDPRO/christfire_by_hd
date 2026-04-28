/** Référentiel documents à présenter / faire signer selon le pays (indicatif métier, non juridique). */

export type LegalDocumentDef = {
  id: string;
  title: string;
  detail: string;
};

export type LegalCountryOption = { code: string; label: string };

export const LEGAL_COUNTRY_OPTIONS: LegalCountryOption[] = [
  { code: "CD", label: "RDC — République démocratique du Congo" },
  { code: "FR", label: "France" },
  { code: "BE", label: "Belgique" },
  { code: "CH", label: "Suisse" },
  { code: "CA", label: "Canada (Québec / fédéral — adapter localement)" },
  { code: "US", label: "États-Unis (État / ville — adapter localement)" },
];

const PACKS: Record<string, LegalDocumentDef[]> = {
  CD: [
    {
      id: "cd-id",
      title: "Pièce d’identité / passeport",
      detail: "Vérification conformité et copie archivage (selon politique lodge).",
    },
    {
      id: "cd-terms",
      title: "Conditions générales de réservation",
      detail: "Tarifs, annulation, responsabilité — version applicable en RDC.",
    },
    {
      id: "cd-house-rules",
      title: "Règlement intérieur du site",
      detail: "Sécurité, bruit, zones communes, animaux, etc.",
    },
    {
      id: "cd-privacy",
      title: "Traitement des données personnelles",
      detail: "Mention conformité locale / registre clients.",
    },
  ],
  FR: [
    {
      id: "fr-id",
      title: "Pièce d’identité",
      detail: "Obligation de déclaration en hébergement (loi applicable).",
    },
    {
      id: "fr-rental",
      title: "Contrat de location / réservation signé",
      detail: "Conditions de séjour, caution, inventaire lié.",
    },
    {
      id: "fr-inventory",
      title: "État des lieux d’entrée",
      detail: "Signature hôte / client ; photos recommandées.",
    },
    {
      id: "fr-deposit",
      title: "Reçu / encaissement caution",
      detail: "Montant, dépôt de garantie, conditions de restitution.",
    },
  ],
  BE: [
    {
      id: "be-id",
      title: "Identité voyageur",
      detail: "Déclaration police de séjour si applicable (commune).",
    },
    {
      id: "be-rental",
      title: "Contrat de location courte durée",
      detail: "Clauses locales (région / commune).",
    },
    {
      id: "be-inventory",
      title: "État des lieux",
      detail: "Entrée et sortie ; litiges dégâts.",
    },
  ],
  CH: [
    {
      id: "ch-id",
      title: "Identification des hôtes",
      detail: "Selon canton / commune (déclaration séjour).",
    },
    {
      id: "ch-contract",
      title: "Contrat de réservation",
      detail: "Conditions, caution, résiliation.",
    },
    {
      id: "ch-inventory",
      title: "Procès-verbal d’état des lieux",
      detail: "Recommandé pour locations meublées.",
    },
  ],
  CA: [
    {
      id: "ca-id",
      title: "Pièce d’identité",
      detail: "Politique lodge + lois provinciales applicables.",
    },
    {
      id: "ca-rental",
      title: "Accord de location / séjour",
      detail: "Adapter province (QC, ON, etc.).",
    },
    {
      id: "ca-liability",
      title: "Décharge / responsabilité",
      detail: "Activités, équipement, mineurs si besoin.",
    },
  ],
  US: [
    {
      id: "us-id",
      title: "ID vérifiée",
      detail: "Selon politique établissement et État.",
    },
    {
      id: "us-rental",
      title: "Rental agreement / registration card",
      detail: "Conditions, dépôt, règles propriété.",
    },
    {
      id: "us-liability",
      title: "Liability / house rules acknowledgment",
      detail: "Signature client.",
    },
  ],
};

export function legalDocumentsForCountry(countryCode: string): LegalDocumentDef[] {
  const code = countryCode.trim().toUpperCase();
  return PACKS[code] ?? PACKS.CD ?? [];
}
