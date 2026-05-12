import { userHasAnyPermission, userHasPermission } from "@/lib/permissions";
import type { AuthUser } from "@/types";
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  KeyRound,
  LayoutGrid,
  Layers,
  Package,
  Palette,
  Ruler,
  ScrollText,
  Shield,
  Tags,
  UserCircle,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export type SettingsTabId =
  | "bungalows"
  | "categories"
  | "stockArticleCategories"
  | "stockArticleUnits"
  | "stockArticleSubcategories"
  | "stockDepots"
  | "terraceTables"
  | "users"
  | "fx"
  | "pricing"
  | "roles"
  | "clientProfiles"
  | "auditLog"
  | "security"
  | "appearance";

export type SettingsTabDef = {
  id: SettingsTabId;
  label: string;
  icon: LucideIcon;
  usersTab?: boolean;
  perm?: string;
  anyPerm?: readonly string[];
  alwaysVisible?: boolean;
};

export const SETTINGS_TAB_DEFS: SettingsTabDef[] = [
  { id: "bungalows", label: "Bungalows", icon: Building2, perm: "lodging.bungalows" },
  { id: "categories", label: "Catégories bungalows", icon: Layers, perm: "settings.edit" },
  {
    id: "stockArticleCategories",
    label: "Catégories article",
    icon: Package,
    perm: "settings.edit",
  },
  {
    id: "stockArticleUnits",
    label: "Unités article",
    icon: Ruler,
    perm: "settings.edit",
  },
  {
    id: "stockArticleSubcategories",
    label: "Sous-catégories article",
    icon: Tags,
    perm: "settings.edit",
  },
  {
    id: "stockDepots",
    label: "Dépôts stock",
    icon: Warehouse,
    perm: "settings.edit",
  },
  {
    id: "terraceTables",
    label: "Tables par terrasse",
    icon: LayoutGrid,
    perm: "settings.edit",
  },
  { id: "users", label: "Utilisateurs", icon: Users, usersTab: true },
  { id: "fx", label: "Taux", icon: ArrowLeftRight, perm: "settings.edit" },
  { id: "pricing", label: "Tarification", icon: Banknote, perm: "settings.edit" },
  { id: "roles", label: "Rôles", icon: Shield, perm: "admin.roles" },
  { id: "clientProfiles", label: "Profils clients", icon: UserCircle, perm: "directory.client_profiles" },
  {
    id: "auditLog",
    label: "Journal d'audit",
    icon: ScrollText,
    anyPerm: ["admin.audit", "admin.sessions"],
  },
  { id: "security", label: "Compte & sécurité", icon: KeyRound, alwaysVisible: true },
  { id: "appearance", label: "Apparence", icon: Palette, alwaysVisible: true },
];

const TAB_TO_ONGLET: Record<SettingsTabId, string> = {
  bungalows: "bungalows",
  categories: "categories",
  stockArticleCategories: "categories-article",
  stockArticleUnits: "unites-article",
  stockArticleSubcategories: "sous-categories-article",
  stockDepots: "depots-stock",
  terraceTables: "tables-terrasse",
  users: "utilisateurs",
  fx: "taux",
  pricing: "tarification",
  roles: "roles",
  clientProfiles: "profils-clients",
  auditLog: "journal-audit",
  security: "compte-securite",
  appearance: "apparence",
};

const ONGLET_TO_TAB: Record<string, SettingsTabId> = Object.fromEntries(
  Object.entries(TAB_TO_ONGLET).map(([id, slug]) => [slug, id as SettingsTabId]),
) as Record<string, SettingsTabId>;

export function settingsTabQueryValue(tab: SettingsTabId): string {
  return TAB_TO_ONGLET[tab];
}

/** Chemin avec `?onglet=` pour le flyout latéral et le partage d’URL. */
export function settingsPathWithTab(tab: SettingsTabId): string {
  return `/parametres?onglet=${encodeURIComponent(settingsTabQueryValue(tab))}`;
}

export function parseSettingsTabFromSearch(onglet: string | null): SettingsTabId | null {
  if (onglet == null || onglet === "") return null;
  return ONGLET_TO_TAB[onglet] ?? null;
}

export function visibleSettingsTabDefs(user: AuthUser | null): SettingsTabDef[] {
  if (!user) return [];
  return SETTINGS_TAB_DEFS.filter((t) => {
    if (t.alwaysVisible) return true;
    if (t.usersTab) {
      return userHasAnyPermission(user, ["users.invite", "users.manage", "users.create"]);
    }
    if (t.anyPerm) return userHasAnyPermission(user, t.anyPerm);
    if (t.perm) return userHasPermission(user, t.perm);
    return false;
  });
}

export type SettingsFlyoutLink = {
  to: string;
  label: string;
  icon: LucideIcon;
  hue: string;
};

export function visibleSettingsFlyoutLinks(user: AuthUser | null): SettingsFlyoutLink[] {
  return visibleSettingsTabDefs(user).map((t) => ({
    to: settingsPathWithTab(t.id),
    label: t.label,
    icon: t.icon,
    hue: "from-white/10",
  }));
}

export function settingsFlyoutGroupActive(pathname: string): boolean {
  return pathname === "/parametres" || pathname.startsWith("/parametres/");
}
