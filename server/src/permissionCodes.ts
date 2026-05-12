/** Catalogue des droits applicatifs (codes stables pour l’API et la matrice UI). */

export type PermissionCatalogEntry = {
  code: string;
  labelFr: string;
  sortOrder: number;
  groupFr: string;
};

const GROUP_CAISSES = "Caisses & encaissements" as const;

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  {
    groupFr: "Paramètres",
    code: "settings.edit",
    labelFr: "Modifier les paramètres (taux, tarifs, catégories, règles…)",
    sortOrder: 10,
  },
  {
    groupFr: "Répertoire",
    code: "directory.client_profiles",
    labelFr: "Gérer les profils clients",
    sortOrder: 20,
  },
  {
    groupFr: "Répertoire",
    code: "directory.clients",
    labelFr: "Gérer les fiches clients (répertoire)",
    sortOrder: 21,
  },
  {
    groupFr: "Administration",
    code: "admin.roles",
    labelFr: "Gérer les rôles et la matrice des droits",
    sortOrder: 30,
  },
  {
    groupFr: "Administration",
    code: "admin.audit",
    labelFr: "Consulter le journal d’audit",
    sortOrder: 40,
  },
  {
    groupFr: "Administration",
    code: "admin.sessions",
    labelFr: "Voir et révoquer les sessions de tous les utilisateurs",
    sortOrder: 50,
  },
  {
    groupFr: "Utilisateurs",
    code: "users.create",
    labelFr: "Créer un compte avec mot de passe (sans invitation)",
    sortOrder: 60,
  },
  {
    groupFr: "Utilisateurs",
    code: "users.invite",
    labelFr: "Inviter des utilisateurs et gérer les invitations en attente",
    sortOrder: 70,
  },
  {
    groupFr: "Utilisateurs",
    code: "users.invite_unrestricted",
    labelFr: "Inviter vers n’importe quel rôle (sans restriction « invit. non-admin »)",
    sortOrder: 80,
  },
  {
    groupFr: "Utilisateurs",
    code: "users.manage",
    labelFr: "Modifier ou désactiver des comptes, réinitialiser le mot de passe",
    sortOrder: 90,
  },
  {
    groupFr: "Utilisateurs",
    code: "users.assign_role",
    labelFr: "Attribuer ou changer le rôle d’un utilisateur existant",
    sortOrder: 100,
  },
  {
    groupFr: "Comptabilité",
    code: "accounting.close_day",
    labelFr: "Clôturer une journée comptable (night audit)",
    sortOrder: 110,
  },
  {
    groupFr: GROUP_CAISSES,
    code: "lodging.reception_cash",
    labelFr: "Caisse réception : séjours (USD) et droit d’entrée visiteurs",
    sortOrder: 111,
  },
  {
    groupFr: GROUP_CAISSES,
    code: "finance.payments",
    labelFr: "Caisse réservations (Finance) : encaissements USD — écran Paiement",
    sortOrder: 112,
  },
  {
    groupFr: GROUP_CAISSES,
    code: "finance.counter",
    labelFr: "Caisse comptoir : ventes buvette / boutique (CDF)",
    sortOrder: 113,
  },
  {
    groupFr: GROUP_CAISSES,
    code: "sales.floor",
    labelFr:
      "Service salle : catalogue articles, tables ; chaque compte ne voit que ses propres ventes (hors trésorerie)",
    sortOrder: 117,
  },
  {
    groupFr: GROUP_CAISSES,
    code: "finance.treasury",
    labelFr:
      "Trésorerie : création et gestion des caisses (points de vente), rapports journaliers et écarts",
    sortOrder: 114,
  },
  {
    groupFr: GROUP_CAISSES,
    code: "finance.cash_book",
    labelFr: "Livre de caisse : comptes caisse / banque, dépenses et virements",
    sortOrder: 115,
  },
  {
    groupFr: "Finance & vente",
    code: "finance.invoices",
    labelFr: "Facturation",
    sortOrder: 120,
  },
  {
    groupFr: "Finance & vente",
    code: "finance.reports",
    labelFr: "Rapports et pilotage (KPI, occupation, canaux)",
    sortOrder: 121,
  },
  {
    groupFr: "Logistique",
    code: "logistics.inventory",
    labelFr: "Stocks & achats : articles, emplacements, réceptions, transferts, inventaire",
    sortOrder: 122,
  },
  {
    groupFr: "Logistique",
    code: "logistics.po_approve_manager",
    labelFr: "Approuver les bons de commande (Manager)",
    sortOrder: 123,
  },
  {
    groupFr: "Logistique",
    code: "logistics.po_approve_dg",
    labelFr: "Approuver les bons de commande (Directeur(rice) général(e))",
    sortOrder: 124,
  },
  {
    groupFr: "Logistique",
    code: "logistics.po_release_finance",
    labelFr: "Bon de commande : déblocage finance (fonds)",
    sortOrder: 125,
  },
  {
    groupFr: "Logistique",
    code: "logistics.po_release_accounting",
    labelFr: "Bon de commande : déblocage comptabilité",
    sortOrder: 126,
  },
  {
    groupFr: "Hébergement",
    code: "lodging.bungalows",
    labelFr: "Bungalows : fiches, création et modification (hors seul état ménage)",
    sortOrder: 130,
  },
  {
    groupFr: "Hébergement",
    code: "lodging.housekeeping",
    labelFr: "Ménage : consulter les unités et mettre à jour l’état ménage",
    sortOrder: 131,
  },
  {
    groupFr: "Hébergement",
    code: "lodging.maintenance",
    labelFr: "Maintenance : tickets, commentaires et pièces jointes",
    sortOrder: 132,
  },
  {
    groupFr: "Hébergement",
    code: "lodging.reservations",
    labelFr: "Réservations : calendrier, création et modification des séjours",
    sortOrder: 133,
  },
  {
    groupFr: "Hébergement",
    code: "lodging.stay_reception",
    labelFr: "Accueil séjour : workflow check-in / check-out et dossier séjour",
    sortOrder: 134,
  },
] as const;

/** Au moins un de ces droits = accès lecture aux listes partagées (bungalows, réservations, tickets…). */
export const LODGING_MODULE_CODES: readonly string[] = [
  "lodging.bungalows",
  "lodging.housekeeping",
  "lodging.maintenance",
  "lodging.reservations",
  "lodging.stay_reception",
  "lodging.reception_cash",
];

export const ALL_PERMISSION_CODES: string[] = PERMISSION_CATALOG.map((p) => p.code);

export const PERMISSION_CODE_SET = new Set(ALL_PERMISSION_CODES);
