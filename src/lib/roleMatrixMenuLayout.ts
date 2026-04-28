import type { PermissionCatalogEntry } from "@/types";

/**
 * Organisation de la matrice des rôles : mêmes regroupements que la navigation
 * (menu principal + sous-menus), pour attribuer les droits de façon intuitive.
 */

export type RoleMatrixLayoutRow = {
  key: string;
  submenu: string;
  /** Chemin d’écran pour repère visuel (optionnel). */
  routeHint?: string;
  codes: readonly string[];
  hintFr?: string;
};

export type RoleMatrixLayoutSection = {
  menuTitle: string;
  /** Texte d’aide sous le titre de section (ex. tableau de bord). */
  introFr?: string;
  rows: readonly RoleMatrixLayoutRow[];
};

/** Ordre d’affichage : aligné sur OrbitalSidebar (Finance → Hébergement → suite). */
export const ROLE_MATRIX_MENU_LAYOUT: readonly RoleMatrixLayoutSection[] = [
  {
    menuTitle: "Tableau de bord",
    introFr:
      "Aucune case ici : l’accueil « Tableau de bord » s’affiche dès qu’au moins une permission est cochée pour le rôle.",
    rows: [],
  },
  {
    menuTitle: "Finance",
    introFr: "Correspond au module Finance du menu (hub et cartes : encaissements, facturation, etc.).",
    rows: [
      { key: "fin-pay", submenu: "Encaissements", routeHint: "/paiement", codes: ["finance.payments"] },
      { key: "fin-inv", submenu: "Facturation", routeHint: "/facturation", codes: ["finance.invoices"] },
      { key: "fin-ctr", submenu: "Vente comptoir", routeHint: "/comptoir", codes: ["finance.counter"] },
      {
        key: "fin-tre",
        submenu: "Trésorerie",
        routeHint: "/tresorerie",
        codes: ["finance.treasury", "lodging.reception_cash"],
        hintFr:
          "L’entrée « Trésorerie » du menu peut aussi apparaître si le rôle a accès comptoir, caisse réception ou accueil séjour.",
      },
      { key: "fin-cb", submenu: "Livre de caisse", routeHint: "/livre-caisse", codes: ["finance.cash_book"] },
      {
        key: "fin-rep",
        submenu: "Rapports & pilotage",
        routeHint: "/rapports",
        codes: ["finance.reports"],
        hintFr:
          "Avec seules les réservations (sans autre droit Finance ci-dessus), le lien « Rapports » est sous Hébergement.",
      },
      { key: "fin-audit", submenu: "Clôture & audit", routeHint: "/cloture-audit", codes: ["accounting.close_day"] },
    ],
  },
  {
    menuTitle: "Hébergement",
    introFr: "Sous-menu « Hébergement » du menu radial (bungalows, ménage, réservations…).",
    rows: [
      { key: "hb-bung", submenu: "Bungalows", routeHint: "/bungalows", codes: ["lodging.bungalows"] },
      { key: "hb-hk", submenu: "Ménage", routeHint: "/menage", codes: ["lodging.housekeeping"] },
      { key: "hb-maint", submenu: "Maintenance", routeHint: "/maintenance", codes: ["lodging.maintenance"] },
      { key: "hb-res", submenu: "Réservations", routeHint: "/reservations", codes: ["lodging.reservations"] },
      { key: "hb-stay", submenu: "Accueil séjour", routeHint: "/accueil-sejour", codes: ["lodging.stay_reception"] },
    ],
  },
  {
    menuTitle: "Clients",
    introFr: "Entrée « Clients » du menu principal.",
    rows: [
      { key: "cl-fiches", submenu: "Fiches clients", routeHint: "/clients", codes: ["directory.clients"] },
      {
        key: "cl-prof",
        submenu: "Profils clients (types de fiche)",
        codes: ["directory.client_profiles"],
        hintFr: "Géré depuis Paramètres → Profils clients ; droit distinct des fiches du répertoire.",
      },
    ],
  },
  {
    menuTitle: "Configuration applicative",
    introFr: "Données de référence (taux, tarifs, catégories…) — écran Paramètres, réservé aux administrateurs application.",
    rows: [{ key: "cfg-set", submenu: "Paramètres métier (SQLite)", codes: ["settings.edit"] }],
  },
  {
    menuTitle: "Administration",
    introFr: "Journal d’audit, sessions, rôles — onglets réservés aux profils autorisés dans Paramètres.",
    rows: [
      { key: "adm-roles", submenu: "Rôles & matrice", codes: ["admin.roles"] },
      { key: "adm-audit", submenu: "Journal d’audit", codes: ["admin.audit"] },
      { key: "adm-sess", submenu: "Sessions utilisateurs", codes: ["admin.sessions"] },
    ],
  },
  {
    menuTitle: "Utilisateurs",
    introFr: "Création de comptes, invitations, gestion des accès.",
    rows: [
      { key: "usr-create", submenu: "Création de comptes", codes: ["users.create"] },
      { key: "usr-inv", submenu: "Invitations", codes: ["users.invite"] },
      { key: "usr-inv-all", submenu: "Invitation sans restriction de rôle", codes: ["users.invite_unrestricted"] },
      { key: "usr-man", submenu: "Gestion des comptes", codes: ["users.manage"] },
      { key: "usr-role", submenu: "Attribution des rôles", codes: ["users.assign_role"] },
    ],
  },
] as const;

const LAYOUT_CODE_SET = new Set(
  ROLE_MATRIX_MENU_LAYOUT.flatMap((s) => s.rows.flatMap((r) => [...r.codes])),
);

function entryMatchesFilter(e: PermissionCatalogEntry, q: string): boolean {
  if (!q) return true;
  return (
    e.labelFr.toLowerCase().includes(q) ||
    e.code.toLowerCase().includes(q) ||
    e.groupFr.toLowerCase().includes(q)
  );
}

export type RoleMatrixResolvedRow = {
  key: string;
  submenu: string;
  routeHint?: string;
  hintFr?: string;
  entries: PermissionCatalogEntry[];
};

export type RoleMatrixResolvedSection = {
  menuTitle: string;
  introFr?: string;
  rows: RoleMatrixResolvedRow[];
  /** Tous les codes de permission présents dans cette section (pour Tout / Aucun). */
  sectionCodes: string[];
};

/** Sections structurées + groupe « Autres » pour tout code du catalogue non listé dans le layout (rétrocompat). */
export function buildRoleMatrixSections(
  catalog: PermissionCatalogEntry[],
  filter: string,
): { sections: RoleMatrixResolvedSection[]; otherSections: [string, PermissionCatalogEntry[]][] } {
  const q = filter.trim().toLowerCase();
  const byCode = new Map(catalog.map((e) => [e.code, e] as const));

  const sections: RoleMatrixResolvedSection[] = [];

  for (const block of ROLE_MATRIX_MENU_LAYOUT) {
    const introMatches =
      !q ||
      block.menuTitle.toLowerCase().includes(q) ||
      (block.introFr?.toLowerCase().includes(q) ?? false);

    if (block.rows.length === 0) {
      if (!q || introMatches) {
        sections.push({ menuTitle: block.menuTitle, introFr: block.introFr, rows: [], sectionCodes: [] });
      }
      continue;
    }

    const rowsOut: RoleMatrixResolvedRow[] = [];
    const sectionCodes = new Set<string>();

    for (const row of block.rows) {
      let entries = row.codes.map((c) => byCode.get(c)).filter((e): e is PermissionCatalogEntry => e != null);
      if (q) entries = entries.filter((e) => entryMatchesFilter(e, q));
      if (entries.length === 0) continue;
      for (const c of row.codes) {
        if (byCode.has(c)) sectionCodes.add(c);
      }
      rowsOut.push({
        key: row.key,
        submenu: row.submenu,
        routeHint: row.routeHint,
        hintFr: row.hintFr,
        entries,
      });
    }

    if (rowsOut.length === 0) {
      if (introMatches) {
        sections.push({
          menuTitle: block.menuTitle,
          introFr: block.introFr,
          rows: [],
          sectionCodes: [...sectionCodes],
        });
      }
      continue;
    }

    sections.push({
      menuTitle: block.menuTitle,
      introFr: block.introFr,
      rows: rowsOut,
      sectionCodes: [...sectionCodes],
    });
  }

  const other: PermissionCatalogEntry[] = [];
  for (const e of catalog) {
    if (!LAYOUT_CODE_SET.has(e.code)) other.push(e);
  }
  const m = new Map<string, PermissionCatalogEntry[]>();
  for (const e of other) {
    if (!entryMatchesFilter(e, q)) continue;
    const arr = m.get(e.groupFr) ?? [];
    arr.push(e);
    m.set(e.groupFr, arr);
  }
  const otherSections = [...m.entries()].sort(([a], [b]) => a.localeCompare(b, "fr"));

  return { sections, otherSections };
}
