import { useAuth } from "@/auth/AuthContext";
import { useTheme } from "@/theme/ThemeContext";
import type { ThemePreference } from "@/theme/themeStorage";
import { StockDepotsSettingsPanel } from "@/components/settings/StockDepotsSettingsPanel";
import { StockItemCategoriesSettingsPanel } from "@/components/settings/StockItemCategoriesSettingsPanel";
import { StockItemSubcategoriesSettingsPanel } from "@/components/settings/StockItemSubcategoriesSettingsPanel";
import { StockItemUnitsSettingsPanel } from "@/components/settings/StockItemUnitsSettingsPanel";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { BUNGALOW_CATEGORY_ORDER, useCategoryLabels } from "@/contexts/CategoryLabelsContext";
import { occupancyRulesSeed, visitorEntryAdultUsdSeed, visitorEntryMinorUsdSeed } from "@/data/mock";
import {
  apiCreateAppUserRole,
  apiCreateBungalow,
  apiCreateClientProfileType,
  apiCancel2faSetup,
  apiCreateUserInvitation,
  apiDeleteAppUserRole,
  apiDeleteClientProfileType,
  apiDeleteUser,
  apiDeleteUserInvitation,
  apiDisable2fa,
  apiGetBungalowCategories,
  apiGetCategoryRates,
  apiGetExchangeRate,
  apiGetOccupancyRules,
  apiGetVisitorEntryPrice,
  apiGetPermissionCatalog,
  apiAdminRevokeSession,
  apiListAdminActiveSessions,
  apiListAuditLog,
  apiListAuthSessions,
  apiListBungalows,
  apiListAppUserRoles,
  apiListClientProfileTypes,
  apiListUserInvitations,
  apiListCounterSalePoints,
  apiListTreasuryPointsOfSale,
  apiListUsers,
  apiPutBungalowCategories,
  apiPutCategoryRates,
  apiPutExchangeRate,
  apiPutOccupancyRules,
  apiPutVisitorEntryPrice,
  apiRevokeAuthSession,
  apiRevokeOtherAuthSessions,
  apiStart2faSetup,
  apiUpdateAppUserRole,
  apiUpdateBungalow,
  apiUpdateUser,
  apiVerify2faSetup,
  type TreasuryPointOfSale,
} from "@/lib/api";
import { buildRoleMatrixSections } from "@/lib/roleMatrixMenuLayout";
import { userHasAnyPermission, userHasPermission } from "@/lib/permissions";
import {
  parseSettingsTabFromSearch,
  settingsTabQueryValue,
  visibleSettingsTabDefs,
  type SettingsTabId,
} from "@/lib/settingsNav";
import type {
   AdminActiveSession,
  AppUserRole,
  AuditLogEntry,
  AuthSessionInfo,
  Bungalow,
  BungalowCategory,
  BungalowCategoryRow,
  BungalowStatus,
  CategoryRate,
  ClientProfileType,
  PermissionCatalogEntry,
  SystemUser,
  UserInvitationPending,
} from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  ChevronRight,
  ExternalLink,
  Hotel,
  LayoutList,
  Lock,
  Monitor,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsGearIcon,
  Settings2,
  Shield,
  Sun,
  Trash2,
  UserCircle,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";

function roleMatrixSectionIcon(menuTitle: string): LucideIcon {
  switch (menuTitle) {
    case "Tableau de bord":
      return BarChart3;
    case "Finance":
      return Banknote;
    case "Hébergement":
      return Hotel;
    case "Clients":
      return Users;
    case "Configuration applicative":
      return Settings2;
    case "Administration":
      return Shield;
    case "Utilisateurs":
      return UserCircle;
    default:
      return LayoutList;
  }
}

function RolePermissionCheckboxes({
  catalog,
  disabled,
  adminRole,
  value,
  onChange,
}: {
  catalog: PermissionCatalogEntry[] | null;
  disabled: boolean;
  adminRole: boolean;
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  /** Sections repliables : true = déplié (défaut pour les blocs affichés). */
  const [matrixSectionOpen, setMatrixSectionOpen] = useState<Record<string, boolean>>({});

  const { sections, otherSections } = useMemo(
    () => buildRoleMatrixSections(catalog ?? [], filter),
    [catalog, filter],
  );

  useEffect(() => {
    setMatrixSectionOpen((prev) => {
      const next = { ...prev };
      for (const s of sections) {
        if (next[s.menuTitle] === undefined) next[s.menuTitle] = true;
      }
      for (const k of Object.keys(next)) {
        if (k.startsWith("__other:")) continue;
        if (!sections.some((s) => s.menuTitle === k)) delete next[k];
      }
      const otherRoot = "__other:root";
      if (otherSections.length > 0 && next[otherRoot] === undefined) next[otherRoot] = true;
      if (otherSections.length === 0) delete next[otherRoot];
      for (const [g] of otherSections) {
        const key = `__other:${g}`;
        if (next[key] === undefined) next[key] = true;
      }
      for (const k of Object.keys(next)) {
        if (!k.startsWith("__other:") || k === otherRoot) continue;
        const g = k.slice("__other:".length);
        if (!otherSections.some(([og]) => og === g)) delete next[k];
      }
      return next;
    });
  }, [sections, otherSections]);

  const visibleCodes = useMemo(() => {
    const set = new Set<string>();
    for (const s of sections) {
      for (const r of s.rows) {
        for (const e of r.entries) set.add(e.code);
      }
    }
    for (const [, items] of otherSections) {
      for (const e of items) set.add(e.code);
    }
    return [...set];
  }, [sections, otherSections]);

  if (!catalog?.length) {
    return <p className="text-xs text-white/40">Chargement du catalogue des droits…</p>;
  }
  if (adminRole) {
    return (
      <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/45">
        Les administrateurs application disposent de tous les droits ; la matrice ne s’applique pas à eux.
      </p>
    );
  }

  const toggle = (code: string, checked: boolean) => {
    if (checked) onChange([...new Set([...value, code])].sort());
    else onChange(value.filter((c) => c !== code));
  };

  const groupSelectAll = (codes: string[]) => {
    if (disabled) return;
    onChange([...new Set([...value, ...codes])].sort());
  };

  const groupClear = (codes: string[]) => {
    if (disabled) return;
    const rm = new Set(codes);
    onChange(value.filter((c) => !rm.has(c)));
  };

  const selectAllVisible = () => {
    if (disabled || visibleCodes.length === 0) return;
    onChange([...new Set([...value, ...visibleCodes])].sort());
  };

  const resetVisibleSelection = () => {
    if (disabled || visibleCodes.length === 0) return;
    const vis = new Set(visibleCodes);
    onChange(value.filter((c) => !vis.has(c)));
  };

  const hasVisibleContent =
    sections.some((s) => s.rows.length > 0 || (s.introFr && s.rows.length === 0)) || otherSections.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-white/45">
          Une case par permission. Blocs alignés sur le menu ; repliez les sections pour vous concentrer sur un domaine.
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-4 text-xs">
          <button
            type="button"
            disabled={disabled || visibleCodes.length === 0}
            title="Coche tous les droits visibles (selon le filtre)"
            onClick={() => selectAllVisible()}
            className="font-medium text-brand-cream/90 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            Tout sélectionner
          </button>
          <button
            type="button"
            disabled={disabled || visibleCodes.length === 0}
            title="Décoche les droits visibles (selon le filtre)"
            onClick={() => resetVisibleSelection()}
            className="font-medium text-white/50 hover:text-white/75 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Réinitialiser
          </button>
        </div>
      </div>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        disabled={disabled}
        placeholder="Filtrer (menu, libellé, code…)…"
        aria-label="Filtrer les permissions par menu ou code"
        className="w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-xs text-white outline-none placeholder:text-white/30 focus:border-brand-orange/35 disabled:opacity-50"
        autoComplete="off"
      />
      <p className="text-[10px] leading-snug text-white/35">
        <strong className="font-medium text-white/45">Tout</strong> / <strong className="font-medium text-white/45">Aucun</strong> sur une
        section ou un sous-menu. Les deux liens du haut s’appliquent à tout ce qui est affiché après filtrage.
      </p>

      <div className="max-h-[min(32rem,60vh)] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3">
        {!hasVisibleContent ? (
          <p className="text-xs text-white/40">Aucun droit ne correspond au filtre.</p>
        ) : (
          <>
            {sections.map((section) => {
              const SectionIcon = roleMatrixSectionIcon(section.menuTitle);
              return (
                <details
                  key={section.menuTitle}
                  className="group border-b border-white/[0.06] pb-3 last:border-b-0 last:pb-0"
                  open={matrixSectionOpen[section.menuTitle] !== false}
                  onToggle={(e) => {
                    const o = e.currentTarget.open;
                    setMatrixSectionOpen((p) => ({ ...p, [section.menuTitle]: o }));
                  }}
                >
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <div className="flex flex-wrap items-start gap-2.5 rounded-lg px-0.5 py-1.5 transition-colors hover:bg-white/[0.04]">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-orange/25 bg-brand-orange/10 text-brand-cream">
                        <SectionIcon className="h-4 w-4" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <ChevronRight
                            className="inline-block h-3.5 w-3.5 shrink-0 text-white/45 transition-transform group-open:rotate-90"
                            aria-hidden
                          />
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-cream/85">
                            {section.menuTitle}
                          </p>
                          {section.sectionCodes.length > 0 ? (
                            <span className="tabular-nums text-[10px] text-white/40">
                              {section.sectionCodes.filter((c) => value.includes(c)).length}/{section.sectionCodes.length}
                            </span>
                          ) : null}
                        </div>
                        {section.introFr ? (
                          <p className="mt-1 text-[10px] leading-snug text-white/38">{section.introFr}</p>
                        ) : null}
                      </div>
                    </div>
                  </summary>

                  {section.sectionCodes.length > 0 && !disabled ? (
                    <div className="mt-1.5 flex flex-wrap justify-end gap-2 text-[10px] text-white/45">
                      <button
                        type="button"
                        onClick={() => groupSelectAll(section.sectionCodes)}
                        className="rounded border border-white/10 px-1.5 py-0.5 font-medium text-brand-orange/90 hover:bg-white/[0.06]"
                      >
                        Tout · section
                      </button>
                      <button
                        type="button"
                        onClick={() => groupClear(section.sectionCodes)}
                        className="rounded border border-white/10 px-1.5 py-0.5 font-medium text-white/55 hover:bg-white/[0.06]"
                      >
                        Aucun · section
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-2 space-y-2 border-l border-white/[0.08] pl-3 sm:ml-1">
                    {section.rows.map((row) => {
                      const codes = row.entries.map((p) => p.code);
                      const sel = codes.filter((c) => value.includes(c)).length;
                      return (
                        <div key={row.key} className="rounded-lg border border-white/[0.07] bg-black/25 px-2.5 py-2">
                          <div className="mb-1.5 flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <p className="text-[11px] font-medium text-white/72">{row.submenu}</p>
                                {codes.length > 0 ? (
                                  <span className="tabular-nums text-[10px] text-white/40">
                                    {sel}/{codes.length}
                                  </span>
                                ) : null}
                              </div>
                              {row.routeHint ? (
                                <p className="mt-0.5 font-mono text-[10px] text-white/32">{row.routeHint}</p>
                              ) : null}
                            </div>
                            {codes.length > 1 && !disabled ? (
                              <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[10px] text-white/45">
                                <button
                                  type="button"
                                  onClick={() => groupSelectAll(codes)}
                                  className="rounded border border-white/10 px-1.5 py-0.5 font-medium text-brand-orange/90 hover:bg-white/[0.06]"
                                >
                                  Tout
                                </button>
                                <button
                                  type="button"
                                  onClick={() => groupClear(codes)}
                                  className="rounded border border-white/10 px-1.5 py-0.5 font-medium text-white/55 hover:bg-white/[0.06]"
                                >
                                  Aucun
                                </button>
                              </div>
                            ) : null}
                          </div>
                          {row.hintFr ? <p className="mb-2 text-[10px] leading-snug text-white/35">{row.hintFr}</p> : null}
                          <div className="divide-y divide-white/[0.06] rounded-md border border-white/[0.05] bg-black/20">
                            {row.entries.map((p) =>
                              disabled ? (
                                <div
                                  key={p.code}
                                  className={`flex items-start gap-2.5 px-2 py-2 ${value.includes(p.code) ? "bg-brand-orange/[0.06]" : ""}`}
                                >
                                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
                                  <div className="min-w-0 flex-1 text-xs leading-snug text-white/50">
                                    <span>{p.labelFr}</span>
                                    <span className="mt-0.5 block font-mono text-[10px] text-white/30">{p.code}</span>
                                  </div>
                                </div>
                              ) : (
                                <label
                                  key={p.code}
                                  className={`flex cursor-pointer items-start gap-2.5 px-2 py-2 ${value.includes(p.code) ? "bg-brand-orange/[0.06]" : ""}`}
                                >
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                                    checked={value.includes(p.code)}
                                    onChange={(e) => toggle(p.code, e.target.checked)}
                                  />
                                  <span className="min-w-0 flex-1 text-xs leading-snug text-white/65">
                                    <span className="text-white/80">{p.labelFr}</span>
                                    <span className="mt-0.5 block font-mono text-[10px] text-white/30">{p.code}</span>
                                  </span>
                                </label>
                              ),
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}

            {otherSections.length > 0 ? (
              <details
                className="group border-t border-dashed border-white/15 pt-3"
                open={matrixSectionOpen["__other:root"] !== false}
                onToggle={(e) => {
                  const o = e.currentTarget.open;
                  setMatrixSectionOpen((p) => ({ ...p, "__other:root": o }));
                }}
              >
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <div className="flex flex-wrap items-start gap-2.5 rounded-lg px-0.5 py-1.5 hover:bg-white/[0.04]">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-orange/25 bg-brand-orange/10 text-brand-cream">
                      <LayoutList className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ChevronRight
                          className="inline-block h-3.5 w-3.5 shrink-0 text-white/45 transition-transform group-open:rotate-90"
                          aria-hidden
                        />
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                          Autres droits (hors arborescence menu)
                        </p>
                      </div>
                      <p className="mt-1 text-[10px] text-white/35">
                        Codes catalogue non classés dans le menu ; regroupés par libellé serveur.
                      </p>
                    </div>
                  </div>
                </summary>
                <div className="mt-2 space-y-3 border-l border-white/[0.08] pl-3 sm:ml-1">
                  {otherSections.map(([group, items]) => {
                    const codes = items.map((p) => p.code);
                    const sel = codes.filter((c) => value.includes(c)).length;
                    return (
                      <details
                        key={group}
                        className="group/os rounded-lg border border-white/[0.07] bg-black/20 px-2 py-2"
                        open={matrixSectionOpen[`__other:${group}`] !== false}
                        onToggle={(e) => {
                          const o = e.currentTarget.open;
                          setMatrixSectionOpen((p) => ({ ...p, [`__other:${group}`]: o }));
                        }}
                      >
                        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <ChevronRight
                                className="inline-block h-3 w-3 shrink-0 text-white/40 transition-transform group-open/os:rotate-90"
                                aria-hidden
                              />
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{group}</p>
                              <span className="tabular-nums text-[10px] text-white/40">
                                {sel}/{codes.length}
                              </span>
                            </div>
                          </div>
                        </summary>
                        {!disabled ? (
                          <div className="mt-2 flex flex-wrap justify-end gap-1.5 text-[10px] text-white/45">
                            <button
                              type="button"
                              onClick={() => groupSelectAll(codes)}
                              className="rounded border border-white/10 px-1.5 py-0.5 font-medium text-brand-orange/90 hover:bg-white/[0.06]"
                            >
                              Tout
                            </button>
                            <button
                              type="button"
                              onClick={() => groupClear(codes)}
                              className="rounded border border-white/10 px-1.5 py-0.5 font-medium text-white/55 hover:bg-white/[0.06]"
                            >
                              Aucun
                            </button>
                          </div>
                        ) : null}
                        <div className="mt-2 divide-y divide-white/[0.06] rounded-md border border-white/[0.05] bg-black/20">
                          {items.map((p) =>
                            disabled ? (
                              <div
                                key={p.code}
                                className={`flex items-start gap-2.5 px-2 py-2 ${value.includes(p.code) ? "bg-brand-orange/[0.06]" : ""}`}
                              >
                                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
                                <div className="min-w-0 flex-1 text-xs leading-snug text-white/50">
                                  <span>{p.labelFr}</span>
                                  <span className="mt-0.5 block font-mono text-[10px] text-white/30">{p.code}</span>
                                </div>
                              </div>
                            ) : (
                              <label
                                key={p.code}
                                className={`flex cursor-pointer items-start gap-2.5 px-2 py-2 ${value.includes(p.code) ? "bg-brand-orange/[0.06]" : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5 rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                                  checked={value.includes(p.code)}
                                  onChange={(e) => toggle(p.code, e.target.checked)}
                                />
                                <span className="min-w-0 flex-1 text-xs leading-snug text-white/65">
                                  <span className="text-white/80">{p.labelFr}</span>
                                  <span className="mt-0.5 block font-mono text-[10px] text-white/30">{p.code}</span>
                                </span>
                              </label>
                            ),
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </details>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const ROLE_BADGE_PALETTE = [
  "border-brand-red/40 bg-brand-red/15 text-brand-cream",
  "border-brand-orange/40 bg-brand-orange/10 text-brand-cream",
  "border-brand-cream/30 bg-brand-cream/10 text-brand-cream/90",
  "border-emerald-400/35 bg-emerald-500/10 text-brand-cream/90",
  "border-sky-400/35 bg-sky-500/10 text-brand-cream/90",
  "border-violet-400/35 bg-violet-500/10 text-brand-cream/90",
  "border-white/25 bg-white/[0.06] text-white/80",
];

function roleBadgeClass(label: string, defs: AppUserRole[] | null): string {
  if (!defs || defs.length === 0) return ROLE_BADGE_PALETTE[ROLE_BADGE_PALETTE.length - 1]!;
  const idx = defs.findIndex((r) => r.label === label);
  if (idx >= 0) return ROLE_BADGE_PALETTE[idx % ROLE_BADGE_PALETTE.length]!;
  return ROLE_BADGE_PALETTE[ROLE_BADGE_PALETTE.length - 1]!;
}

const BUNGALOW_STATUSES: BungalowStatus[] = ["Disponible", "Réservé", "Occupé", "Maintenance", "Hors service"];

function userActionErrorMessage(code: string): string {
  switch (code) {
    case "last_admin":
      return "Impossible : il doit rester au moins un administrateur.";
    case "cannot_delete_self":
      return "Vous ne pouvez pas supprimer votre propre compte.";
    case "cannot_deactivate_self":
      return "Vous ne pouvez pas désactiver votre propre compte.";
    case "email_taken":
      return "Cet e-mail est déjà utilisé.";
    case "not_found":
      return "Utilisateur introuvable.";
    case "forbidden":
      return "Action non autorisée.";
    case "forbidden_role_assignment":
      return "Vous n’avez pas le droit d’attribuer ce rôle ou de modifier les rôles utilisateurs.";
    case "label_taken":
      return "Ce libellé de rôle est déjà utilisé.";
    case "system_role":
      return "Ce rôle système ne peut pas être supprimé ni renommé.";
    case "role_in_use":
      return "Ce rôle est encore attribué à des utilisateurs.";
    case "pending_invites":
      return "Révoquez d’abord les invitations en attente qui utilisent ce rôle.";
    case "last_admin_role":
      return "Au moins un rôle « administrateur application » doit rester défini.";
    case "network_error":
      return "Réseau indisponible.";
    case "unknown_point_of_sale":
      return "Une ou plusieurs caisses comptoir sélectionnées sont invalides.";
    default:
      return "L’action a échoué. Réessayez.";
  }
}

function clientProfileActionError(code: string): string {
  switch (code) {
    case "code_taken":
      return "Ce code technique est déjà utilisé.";
    case "in_use":
      return "Des clients sont encore rattachés à ce profil. Modifiez leur fiche avant de supprimer.";
    case "last_profile":
      return "Au moins un profil doit rester défini.";
    case "forbidden":
      return "Droits insuffisants pour gérer les profils clients.";
    case "validation_error":
      return "Code : lettre minuscule puis lettres, chiffres ou _ (max. 48 car.). Libellé obligatoire.";
    case "unauthorized":
      return "Session expirée.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "L’opération a échoué. Réessayez.";
  }
}

function formatAuditAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function auditActionLabel(action: AuditLogEntry["action"]): string {
  switch (action) {
    case "create":
      return "Création";
    case "update":
      return "Modification";
    case "delete":
      return "Suppression";
    default:
      return action;
  }
}

function auditEntityKindLabel(entityType: string): string {
  const map: Record<string, string> = {
    client: "Client",
    bungalow: "Bungalow",
    reservation: "Réservation",
    user: "Utilisateur",
    user_invitation: "Invitation",
    payment: "Paiement",
    settings: "Paramètres",
    client_profile_type: "Profil client",
    app_user_role: "Rôle",
  };
  return map[entityType] ?? entityType;
}

const themeChoices: { id: ThemePreference; label: string; description: string; icon: LucideIcon }[] = [
  { id: "dark", label: "Sombre", description: "Interface type braises, optimisée en faible lumière.", icon: Moon },
  { id: "light", label: "Clair", description: "Fond papier chaud et texte foncé.", icon: Sun },
  { id: "system", label: "Système", description: "Suit le réglage clair / sombre de l’appareil.", icon: Monitor },
];

export function Settings() {
  const { user, refreshUser, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { refreshCategoryLabels } = useCategoryLabels();
  const { preference, resolvedDark, setPreference } = useTheme();
  const baseId = useId();
  const [rates, setRates] = useState<CategoryRate[]>([]);
  const [ratesSavedFlash, setRatesSavedFlash] = useState(false);
  /** CDF pour 1 USD (taux de référence interne, ex. caisse / facturation). */
  const [cdfPerUsd, setCdfPerUsd] = useState(2850);
  const [fxSavedFlash, setFxSavedFlash] = useState(false);
  const [pricingDbLoading, setPricingDbLoading] = useState(true);
  const [pricingDbError, setPricingDbError] = useState(false);
  const [fxSaveErr, setFxSaveErr] = useState<string | null>(null);
  const [ratesSaveErr, setRatesSaveErr] = useState<string | null>(null);
  /** Tarifs droit d’entrée visiteur (USD / personne), même onglet que les nuitées. */
  const [visitorEntryAdultUsd, setVisitorEntryAdultUsd] = useState(visitorEntryAdultUsdSeed);
  const [visitorEntryMinorUsd, setVisitorEntryMinorUsd] = useState(visitorEntryMinorUsdSeed);
  /** Jours calendaires après le début du séjour (1–5) avant pénalité si le logement n’est pas occupé. */
  const [occupancyGraceDays, setOccupancyGraceDays] = useState(occupancyRulesSeed.graceDays);
  const [occupancyPenaltyUsd, setOccupancyPenaltyUsd] = useState(occupancyRulesSeed.penaltyUsd);

  const [categoryRows, setCategoryRows] = useState<BungalowCategoryRow[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState(false);
  const [categoriesSaveErr, setCategoriesSaveErr] = useState<string | null>(null);
  const [categoriesSavedFlash, setCategoriesSavedFlash] = useState(false);

  const canEditSettings = userHasPermission(user, "settings.edit");
  const tabs = useMemo(() => visibleSettingsTabDefs(user), [user]);

  const tab = useMemo((): SettingsTabId => {
    const parsed = parseSettingsTabFromSearch(searchParams.get("onglet"));
    if (parsed && tabs.some((t) => t.id === parsed)) return parsed;
    return tabs[0]?.id ?? "security";
  }, [searchParams, tabs]);

  const setTab = useCallback(
    (id: SettingsTabId) => {
      setSearchParams({ onglet: settingsTabQueryValue(id) }, { replace: true });
    },
    [setSearchParams],
  );

  useEffect(() => {
    const slug = settingsTabQueryValue(tab);
    if (searchParams.get("onglet") !== slug) {
      setSearchParams({ onglet: slug }, { replace: true });
    }
  }, [tab, searchParams, setSearchParams]);
  /** Données SQLite : taux, tarifs, catégories, règles (droit `settings.edit`). */
  const pricingReadOnly = !canEditSettings;
  const categoriesReadOnly = pricingReadOnly;
  const [remoteUsers, setRemoteUsers] = useState<SystemUser[] | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersApiError, setUsersApiError] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteDone, setInviteDone] = useState<{ expiresAt: string; email: string } | null>(null);
  const [nvName, setNvName] = useState("");
  const [nvEmail, setNvEmail] = useState("");
  const [nvRole, setNvRole] = useState("");
  const [nvActive, setNvActive] = useState(true);
  const [pendingInvitations, setPendingInvitations] = useState<UserInvitationPending[]>([]);
  const [inviteRevokeBusy, setInviteRevokeBusy] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<SystemUser | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [edPointOfSaleIds, setEdPointOfSaleIds] = useState<string[]>([]);
  const [posAssignOptions, setPosAssignOptions] = useState<TreasuryPointOfSale[]>([]);
  const [edName, setEdName] = useState("");
  const [edEmail, setEdEmail] = useState("");
  const [edPassword, setEdPassword] = useState("");
  const [edRole, setEdRole] = useState("");
  const [edActive, setEdActive] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SystemUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  /** Erreur API après Activer / Désactiver depuis le tableau (pas d’alerte navigateur). */
  const [toggleActiveErr, setToggleActiveErr] = useState<string | null>(null);

  const [clientProfileTypes, setClientProfileTypes] = useState<ClientProfileType[]>([]);
  const [clientProfilesLoading, setClientProfilesLoading] = useState(false);
  const [clientProfilesError, setClientProfilesError] = useState(false);
  const [newCpCode, setNewCpCode] = useState("");
  const [newCpLabel, setNewCpLabel] = useState("");
  const [newCpHint, setNewCpHint] = useState("");
  const [newCpSort, setNewCpSort] = useState(99);
  const [newCpEmailOpt, setNewCpEmailOpt] = useState(false);
  const [newCpAppliesEntryFee, setNewCpAppliesEntryFee] = useState(false);
  const [newCpBusy, setNewCpBusy] = useState(false);
  const [newCpErr, setNewCpErr] = useState<string | null>(null);
  const [delCpTarget, setDelCpTarget] = useState<ClientProfileType | null>(null);
  const [delCpBusy, setDelCpBusy] = useState(false);
  const [delCpErr, setDelCpErr] = useState<string | null>(null);

  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState(false);
  const [auditActorUserId, setAuditActorUserId] = useState<string | null>(null);
  const [auditActorLabel, setAuditActorLabel] = useState<string | null>(null);
  const [adminAllSessions, setAdminAllSessions] = useState<AdminActiveSession[] | null>(null);
  const [adminSessionsLoading, setAdminSessionsLoading] = useState(false);

  const [securitySessions, setSecuritySessions] = useState<AuthSessionInfo[] | null>(null);
  const [securitySessionsLoading, setSecuritySessionsLoading] = useState(false);
  const [twofaSetup, setTwofaSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [twofaVerifyCode, setTwofaVerifyCode] = useState("");
  const [twofaBusy, setTwofaBusy] = useState(false);
  const [twofaErr, setTwofaErr] = useState<string | null>(null);
  const [disable2faPassword, setDisable2faPassword] = useState("");
  const [disable2faTotp, setDisable2faTotp] = useState("");
  const [disable2faBusy, setDisable2faBusy] = useState(false);
  const [disable2faErr, setDisable2faErr] = useState<string | null>(null);

  const [remoteBungalows, setRemoteBungalows] = useState<Bungalow[] | null>(null);
  const [bungalowsLoading, setBungalowsLoading] = useState(false);
  const [bungalowsApiError, setBungalowsApiError] = useState(false);
  const [bungalowModal, setBungalowModal] = useState<"create" | "edit" | null>(null);
  const [editBungalowId, setEditBungalowId] = useState<string | null>(null);
  const [bFormBusy, setBFormBusy] = useState(false);
  const [bFormErr, setBFormErr] = useState<string | null>(null);
  const [bfCode, setBfCode] = useState("");
  const [bfLabel, setBfLabel] = useState("");
  const [bfCategory, setBfCategory] = useState<BungalowCategory>("Standard");
  const [bfRooms, setBfRooms] = useState<1 | 2>(1);
  const [bfCapacity, setBfCapacity] = useState<1 | 2 | 3>(2);
  const [bfDescription, setBfDescription] = useState("");
  const [bfImage, setBfImage] = useState("");
  const [bfAmenities, setBfAmenities] = useState("");
  const [bfStatus, setBfStatus] = useState<BungalowStatus>("Disponible");

  const canInviteUser = userHasPermission(user, "users.invite");
  const canManageUserRecords = userHasPermission(user, "users.manage");
  /** Attribution et modification des rôles (droit `users.assign_role`, ou admin app.). */
  const canAssignRoles = userHasPermission(user, "users.assign_role");

  const [appRoles, setAppRoles] = useState<AppUserRole[] | null>(null);
  const [permCatalog, setPermCatalog] = useState<PermissionCatalogEntry[] | null>(null);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesApiError, setRolesApiError] = useState(false);
  const [newUrLabel, setNewUrLabel] = useState("");
  const [newUrSort, setNewUrSort] = useState(99);
  const [newUrAdmin, setNewUrAdmin] = useState(false);
  const [newUrInvite, setNewUrInvite] = useState(false);
  const [newUrPerms, setNewUrPerms] = useState<string[]>([]);
  /** Rôle existant dont on copie la matrice à la création (optionnel). */
  const [newUrCloneFromId, setNewUrCloneFromId] = useState("");
  const [newUrBusy, setNewUrBusy] = useState(false);
  const [newUrErr, setNewUrErr] = useState<string | null>(null);
  const [editUr, setEditUr] = useState<AppUserRole | null>(null);
  const [editUrLabel, setEditUrLabel] = useState("");
  const [editUrSort, setEditUrSort] = useState(0);
  const [editUrAdmin, setEditUrAdmin] = useState(false);
  const [editUrInvite, setEditUrInvite] = useState(false);
  const [editUrPerms, setEditUrPerms] = useState<string[]>([]);
  const [editUrBusy, setEditUrBusy] = useState(false);
  const [editUrErr, setEditUrErr] = useState<string | null>(null);
  const [delUrTarget, setDelUrTarget] = useState<AppUserRole | null>(null);
  const [delUrBusy, setDelUrBusy] = useState(false);
  const [delUrErr, setDelUrErr] = useState<string | null>(null);
  /** Panneau droit : liste / création / édition (id du rôle). */
  const [rolesPanel, setRolesPanel] = useState<"idle" | "new" | string>("idle");
  const [rolesListQuery, setRolesListQuery] = useState("");

  const reloadUsers = useCallback(async () => {
    const list = await apiListUsers();
    if (list !== null) {
      setRemoteUsers(list);
      setUsersApiError(false);
    }
  }, []);

  const reloadBungalows = useCallback(async () => {
    const b = await apiListBungalows();
    if (b === null) {
      setBungalowsApiError(true);
      setRemoteBungalows(null);
    } else {
      setBungalowsApiError(false);
      setRemoteBungalows(b);
    }
  }, []);

  const openInvite = useCallback(async () => {
    setToggleActiveErr(null);
    setInviteErr(null);
    setInviteDone(null);
    setNvName("");
    setNvEmail("");
    let ordered = appRoles ?? [];
    if (ordered.length === 0) {
      const list = await apiListAppUserRoles();
      if (list) {
        setAppRoles(list);
        ordered = list;
      }
    }
    if (canAssignRoles) {
      setNvRole(ordered[0]?.label ?? "");
    } else {
      const inv = ordered.filter((r) => r.allowNonAdminInvite);
      setNvRole(inv[0]?.label ?? "");
    }
    setNvActive(true);
    setInviteOpen(true);
  }, [appRoles, canAssignRoles]);

  const submitInvite = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setInviteErr(null);
      setInviteBusy(true);
      try {
        const res = await apiCreateUserInvitation({
          name: nvName.trim(),
          email: nvEmail.trim(),
          role: nvRole,
          active: nvActive,
        });
        if (!res.ok) {
          if (res.code === "email_taken") setInviteErr("Cet e-mail est déjà utilisé ou une invitation est en cours.");
          else if (res.code === "forbidden_role_assignment")
            setInviteErr(userActionErrorMessage("forbidden_role_assignment"));
          else if (res.code === "forbidden") setInviteErr("Droits insuffisants.");
          else if (res.code === "email_not_configured")
            setInviteErr(
              "Envoi e-mail non configuré sur le serveur (SMTP_HOST et MAIL_FROM dans .env). Contactez l’administrateur.",
            );
          else if (res.code === "public_url_required")
            setInviteErr(
              "Impossible de déterminer l’adresse publique de l’app. Définissez APP_PUBLIC_URL sur le serveur (ex. https://votre-domaine.com).",
            );
          else if (res.code === "email_send_failed")
            setInviteErr("L’e-mail n’a pas pu être envoyé (serveur SMTP). Vérifiez la configuration et réessayez.");
          else if (res.code === "validation_error")
            setInviteErr("Données invalides (nom, e-mail, rôle).");
          else if (res.code === "network_error") setInviteErr("Réseau indisponible.");
          else setInviteErr("Impossible de créer l’invitation. Réessayez.");
          return;
        }
        setInviteDone({ expiresAt: res.result.expiresAt, email: res.result.invitee.email });
        const inv = await apiListUserInvitations();
        if (inv !== null) setPendingInvitations(inv);
        await reloadUsers();
      } finally {
        setInviteBusy(false);
      }
    },
    [nvActive, nvEmail, nvName, nvRole, reloadUsers],
  );

  const revokePendingInvite = useCallback(async (id: string) => {
    setInviteRevokeBusy(id);
    try {
      const res = await apiDeleteUserInvitation(id);
      if (res.ok) {
        setPendingInvitations((prev) => prev.filter((i) => i.id !== id));
      }
    } finally {
      setInviteRevokeBusy(null);
    }
  }, []);

  const openEdit = useCallback((u: SystemUser) => {
    setToggleActiveErr(null);
    setEditErr(null);
    setEditUser(u);
    setEdName(u.name);
    setEdEmail(u.email);
    setEdPassword("");
    setEdRole(u.role);
    setEdActive(u.active);
    setEdPointOfSaleIds([...(u.pointOfSaleIds ?? [])]);
  }, []);

  useEffect(() => {
    if (!editUser || !canManageUserRecords) {
      setPosAssignOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const t = await apiListTreasuryPointsOfSale();
      if (cancelled) return;
      if (t !== null && t.length > 0) {
        setPosAssignOptions(t);
        return;
      }
      const c = await apiListCounterSalePoints();
      if (cancelled) return;
      if (c === null) {
        setPosAssignOptions([]);
        return;
      }
      setPosAssignOptions(
        c.map((p) => ({
          id: p.id,
          code: p.code,
          label: p.label,
          sortOrder: p.sortOrder,
          isMain: p.isMain,
          active: true,
          stockLocationId: "",
          stockLocationLabel: "",
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [editUser, canManageUserRecords]);

  const submitEdit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editUser) return;
      setEditErr(null);
      if (edPassword.length > 0 && edPassword.length < 8) {
        setEditErr("Le nouveau mot de passe doit faire au moins 8 caractères, ou laissez le champ vide.");
        return;
      }
      setEditBusy(true);
      try {
        const body = {
          name: edName.trim(),
          email: edEmail.trim(),
          active: edActive,
          ...(canAssignRoles ? { role: edRole } : {}),
          ...(edPassword.length >= 8 ? { password: edPassword } : {}),
          ...(canManageUserRecords ? { pointOfSaleIds: edPointOfSaleIds } : {}),
        };
        const res = await apiUpdateUser(editUser.id, body);
        if (!res.ok) {
          setEditErr(userActionErrorMessage(res.code));
          return;
        }
        setEditUser(null);
        await reloadUsers();
      } finally {
        setEditBusy(false);
      }
    },
    [
      canAssignRoles,
      canManageUserRecords,
      edActive,
      edEmail,
      edName,
      edPassword,
      edPointOfSaleIds,
      edRole,
      editUser,
      reloadUsers,
    ],
  );

  const handleToggleActive = useCallback(
    async (u: SystemUser) => {
      if (!canManageUserRecords || u.id === user?.id) return;
      setToggleActiveErr(null);
      const res = await apiUpdateUser(u.id, { active: !u.active });
      if (res.ok) await reloadUsers();
      else setToggleActiveErr(userActionErrorMessage(res.code));
    },
    [canManageUserRecords, reloadUsers, user?.id],
  );

  const openDeleteConfirm = useCallback(
    (u: SystemUser) => {
      if (!canManageUserRecords || u.id === user?.id) return;
      setToggleActiveErr(null);
      setDeleteErr(null);
      setDeleteTarget(u);
    },
    [canManageUserRecords, user?.id],
  );

  const cancelDeleteConfirm = useCallback(() => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeleteErr(null);
  }, [deleteBusy]);

  const confirmDeleteUser = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteErr(null);
    setDeleteBusy(true);
    try {
      const res = await apiDeleteUser(deleteTarget.id);
      if (!res.ok) {
        setDeleteErr(userActionErrorMessage(res.code));
        return;
      }
      setDeleteTarget(null);
      await reloadUsers();
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTarget, reloadUsers]);

  const reloadAppRoles = useCallback(async (): Promise<AppUserRole[] | null> => {
    const list = await apiListAppUserRoles();
    if (list !== null) setAppRoles(list);
    return list;
  }, []);

  const openEditAppRole = useCallback((row: AppUserRole) => {
    setRolesPanel(row.id);
    setEditUrErr(null);
    setEditUr(row);
    setEditUrLabel(row.label);
    setEditUrSort(row.sortOrder);
    setEditUrAdmin(row.isAppAdmin);
    setEditUrInvite(row.allowNonAdminInvite);
    setEditUrPerms(row.permissions ?? []);
  }, []);

  const startNewAppRole = useCallback(() => {
    setRolesPanel("new");
    setEditUr(null);
    setEditUrErr(null);
    setNewUrLabel("");
    setNewUrSort(99);
    setNewUrAdmin(false);
    setNewUrInvite(false);
    setNewUrPerms([]);
    setNewUrCloneFromId("");
    setNewUrErr(null);
  }, []);

  const submitNewAppRole = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setNewUrErr(null);
      const label = newUrLabel.trim();
      if (!label) {
        setNewUrErr("Libellé obligatoire.");
        return;
      }
      setNewUrBusy(true);
      try {
        const res = await apiCreateAppUserRole({
          label,
          sortOrder: newUrSort,
          isAppAdmin: newUrAdmin,
          allowNonAdminInvite: newUrInvite,
          ...(!newUrAdmin ? { permissions: newUrPerms } : {}),
        });
        if (!res.ok) {
          setNewUrErr(userActionErrorMessage(res.code));
          return;
        }
        setNewUrLabel("");
        setNewUrSort(99);
        setNewUrAdmin(false);
        setNewUrInvite(false);
        setNewUrPerms([]);
        setNewUrCloneFromId("");
        await reloadAppRoles();
        openEditAppRole(res.role);
      } finally {
        setNewUrBusy(false);
      }
    },
    [newUrAdmin, newUrInvite, newUrLabel, newUrPerms, newUrSort, openEditAppRole, reloadAppRoles],
  );

  const submitEditAppRole = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editUr) return;
      setEditUrErr(null);
      const label = editUrLabel.trim();
      if (!label) {
        setEditUrErr("Libellé obligatoire.");
        return;
      }
      setEditUrBusy(true);
      try {
        const res = await apiUpdateAppUserRole(editUr.id, {
          label,
          sortOrder: editUrSort,
          isAppAdmin: editUrAdmin,
          allowNonAdminInvite: editUrInvite,
          ...(!editUrAdmin ? { permissions: editUrPerms } : {}),
        });
        if (!res.ok) {
          setEditUrErr(userActionErrorMessage(res.code));
          return;
        }
        const savedId = editUr.id;
        const fresh = await reloadAppRoles();
        await reloadUsers();
        const row = fresh?.find((r) => r.id === savedId);
        if (row) openEditAppRole(row);
      } finally {
        setEditUrBusy(false);
      }
    },
    [editUr, editUrAdmin, editUrInvite, editUrLabel, editUrPerms, editUrSort, openEditAppRole, reloadAppRoles, reloadUsers],
  );

  const confirmDeleteAppRole = useCallback(async () => {
    if (!delUrTarget) return;
    const deletedId = delUrTarget.id;
    setDelUrErr(null);
    setDelUrBusy(true);
    try {
      const res = await apiDeleteAppUserRole(deletedId);
      if (!res.ok) {
        setDelUrErr(userActionErrorMessage(res.code));
        return;
      }
      setDelUrTarget(null);
      setRolesPanel((p) => (p === deletedId ? "idle" : p));
      setEditUr((e) => (e?.id === deletedId ? null : e));
      await reloadAppRoles();
    } finally {
      setDelUrBusy(false);
    }
  }, [delUrTarget, reloadAppRoles]);

  const filteredAppRoles = useMemo(() => {
    const list = appRoles ?? [];
    const q = rolesListQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => r.label.toLowerCase().includes(q));
  }, [appRoles, rolesListQuery]);

  const rolesOverview = useMemo(() => {
    const list = appRoles ?? [];
    if (list.length === 0) return null;
    return {
      total: list.length,
      adminCount: list.filter((r) => r.isAppAdmin).length,
      systemCount: list.filter((r) => r.isSystem).length,
    };
  }, [appRoles]);

  const displayBungalows = useMemo(() => remoteBungalows ?? [], [remoteBungalows]);

  useEffect(() => {
    if (tab !== "bungalows" || !userHasPermission(user, "lodging.bungalows")) return;
    let cancelled = false;
    setBungalowsLoading(true);
    void (async () => {
      const b = await apiListBungalows();
      if (cancelled) return;
      setBungalowsLoading(false);
      if (b === null) {
        setBungalowsApiError(true);
        setRemoteBungalows(null);
      } else {
        setBungalowsApiError(false);
        setRemoteBungalows(b);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, user]);

  const closeBungalowModal = useCallback(() => {
    if (bFormBusy) return;
    setBungalowModal(null);
    setEditBungalowId(null);
    setBFormErr(null);
  }, [bFormBusy]);

  const openCreateBungalow = useCallback(() => {
    setBFormErr(null);
    setEditBungalowId(null);
    setBfCode("");
    setBfLabel("");
    setBfCategory("Standard");
    setBfRooms(1);
    setBfCapacity(2);
    setBfDescription("");
    setBfImage("");
    setBfAmenities("");
    setBfStatus("Disponible");
    setBungalowModal("create");
  }, []);

  const openEditBungalow = useCallback((row: Bungalow) => {
    setBFormErr(null);
    setEditBungalowId(row.id);
    setBfCode(row.code);
    setBfLabel(row.label);
    setBfCategory(row.category);
    setBfRooms(row.rooms);
    setBfCapacity(row.capacity);
    setBfDescription(row.description);
    setBfImage(row.image);
    setBfAmenities(row.amenities.join("\n"));
    setBfStatus(row.status);
    setBungalowModal("edit");
  }, []);

  const submitBungalowForm = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBFormErr(null);
      setBFormBusy(true);
      try {
        const amenities = bfAmenities
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        const body = {
          code: bfCode.trim(),
          label: bfLabel.trim(),
          category: bfCategory,
          rooms: bfRooms,
          capacity: bfCapacity,
          description: bfDescription.trim(),
          image: bfImage.trim(),
          amenities,
          status: bfStatus,
        };
        if (bungalowModal === "create") {
          const res = await apiCreateBungalow(body);
          if (!res.ok) {
            if (res.code === "code_taken") setBFormErr("Ce code est déjà utilisé.");
            else if (res.code === "validation_error") setBFormErr("Vérifiez les champs (code, libellé, catégorie…).");
            else if (res.code === "unauthorized") setBFormErr("Session expirée. Reconnectez-vous.");
            else if (res.code === "network_error") setBFormErr("Réseau indisponible.");
            else setBFormErr("Enregistrement impossible. Réessayez.");
            return;
          }
        } else if (bungalowModal === "edit" && editBungalowId) {
          const res = await apiUpdateBungalow(editBungalowId, body);
          if (!res.ok) {
            if (res.code === "code_taken") setBFormErr("Ce code est déjà utilisé.");
            else if (res.code === "not_found") setBFormErr("Bungalow introuvable.");
            else if (res.code === "validation_error") setBFormErr("Vérifiez les champs.");
            else if (res.code === "unauthorized") setBFormErr("Session expirée.");
            else if (res.code === "network_error") setBFormErr("Réseau indisponible.");
            else setBFormErr("Mise à jour impossible. Réessayez.");
            return;
          }
        }
        setBungalowModal(null);
        setEditBungalowId(null);
        await reloadBungalows();
      } finally {
        setBFormBusy(false);
      }
    },
    [
      bfAmenities,
      bfCapacity,
      bfCategory,
      bfCode,
      bfDescription,
      bfImage,
      bfLabel,
      bfRooms,
      bfStatus,
      bungalowModal,
      editBungalowId,
      reloadBungalows,
    ],
  );

  const saveRates = useCallback(async () => {
    setRatesSaveErr(null);
    const va = Math.floor(visitorEntryAdultUsd);
    const vm = Math.floor(visitorEntryMinorUsd);
    if (!Number.isFinite(va) || va < 1 || !Number.isFinite(vm) || vm < 1) {
      setRatesSaveErr("Les tarifs adulte et mineur doivent être des montants USD entiers ≥ 1.");
      return;
    }
    const gd = Math.floor(occupancyGraceDays);
    const pen = Math.floor(occupancyPenaltyUsd);
    if (!Number.isFinite(gd) || gd < 1 || gd > 5) {
      setRatesSaveErr("Le délai d’occupation doit être un nombre entier entre 1 et 5 jours.");
      return;
    }
    if (!Number.isFinite(pen) || pen < 0) {
      setRatesSaveErr("La pénalité doit être un montant USD entier ≥ 0.");
      return;
    }
    const [resRates, resVisitor, resOcc] = await Promise.all([
      apiPutCategoryRates(rates),
      apiPutVisitorEntryPrice({ adultPriceUsd: va, minorPriceUsd: vm }),
      apiPutOccupancyRules({ graceDays: gd, penaltyUsd: pen }),
    ]);
    if (resRates.ok && resVisitor.ok && resOcc.ok) {
      setRates(resRates.rates);
      setVisitorEntryAdultUsd(resVisitor.adultPriceUsd);
      setVisitorEntryMinorUsd(resVisitor.minorPriceUsd);
      setOccupancyGraceDays(resOcc.graceDays);
      setOccupancyPenaltyUsd(resOcc.penaltyUsd);
      setRatesSavedFlash(true);
      window.setTimeout(() => setRatesSavedFlash(false), 2200);
    } else {
      const code = !resRates.ok
        ? resRates.code
        : !resVisitor.ok
          ? resVisitor.code
          : !resOcc.ok
            ? resOcc.code
            : "error";
      setRatesSaveErr(
        code === "forbidden"
          ? "Droits insuffisants pour modifier les paramètres."
          : code === "unauthorized"
            ? "Session expirée."
            : code === "validation_error"
              ? "Vérifiez les montants (USD entiers)."
              : "Enregistrement impossible.",
      );
    }
  }, [occupancyGraceDays, occupancyPenaltyUsd, rates, visitorEntryAdultUsd, visitorEntryMinorUsd]);

  const saveFx = useCallback(async () => {
    setFxSaveErr(null);
    const res = await apiPutExchangeRate(cdfPerUsd);
    if (res.ok) {
      setFxSavedFlash(true);
      window.setTimeout(() => setFxSavedFlash(false), 2200);
    } else {
      setFxSaveErr(
        res.code === "forbidden"
          ? "Droits insuffisants pour modifier les paramètres."
          : res.code === "unauthorized"
            ? "Session expirée."
            : "Enregistrement impossible.",
      );
    }
  }, [cdfPerUsd]);

  const saveCategories = useCallback(async () => {
    setCategoriesSaveErr(null);
    const sorted = [...categoryRows].sort(
      (a, b) => BUNGALOW_CATEGORY_ORDER.indexOf(a.key) - BUNGALOW_CATEGORY_ORDER.indexOf(b.key),
    );
    const res = await apiPutBungalowCategories(sorted);
    if (res.ok) {
      setCategoryRows(
        [...res.categories].sort(
          (a, b) => BUNGALOW_CATEGORY_ORDER.indexOf(a.key) - BUNGALOW_CATEGORY_ORDER.indexOf(b.key),
        ),
      );
      await refreshCategoryLabels();
      setCategoriesSavedFlash(true);
      window.setTimeout(() => setCategoriesSavedFlash(false), 2200);
    } else {
      setCategoriesSaveErr(
        res.code === "forbidden"
          ? "Droits insuffisants pour modifier les paramètres."
          : res.code === "unauthorized"
            ? "Session expirée."
            : "Enregistrement impossible.",
      );
    }
  }, [categoryRows, refreshCategoryLabels]);

  const updateRate = (category: BungalowCategory, value: number) => {
    if (pricingReadOnly) return;
    setRates((prev) => prev.map((r) => (r.category === category ? { ...r, pricePerNightUSD: value } : r)));
  };

  useEffect(() => {
    let cancelled = false;
    setPricingDbLoading(true);
    setPricingDbError(false);
    void (async () => {
      const [fx, cr, ve, occ] = await Promise.all([
        apiGetExchangeRate(),
        apiGetCategoryRates(),
        apiGetVisitorEntryPrice(),
        apiGetOccupancyRules(),
      ]);
      if (cancelled) return;
      setPricingDbLoading(false);
      if (fx) setCdfPerUsd(fx.cdfPerUsd);
      if (cr && cr.length >= 3) {
        const order: BungalowCategory[] = ["Premium", "Deluxe", "Standard"];
        const next = order.map((c) => cr.find((x) => x.category === c)).filter(Boolean) as CategoryRate[];
        if (next.length === 3) setRates(next);
      }
      if (ve) {
        setVisitorEntryAdultUsd(ve.adultPriceUsd);
        setVisitorEntryMinorUsd(ve.minorPriceUsd);
      }
      if (occ) {
        setOccupancyGraceDays(occ.graceDays);
        setOccupancyPenaltyUsd(occ.penaltyUsd);
      }
      if (!fx || !cr || cr.length < 3 || !ve || !occ) setPricingDbError(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCategoriesLoading(true);
    setCategoriesError(false);
    void (async () => {
      const rows = await apiGetBungalowCategories();
      if (cancelled) return;
      setCategoriesLoading(false);
      if (rows === null || rows.length < 3) {
        setCategoriesError(true);
        setCategoryRows([]);
      } else {
        setCategoriesError(false);
        setCategoryRows(
          [...rows].sort(
            (a, b) => BUNGALOW_CATEGORY_ORDER.indexOf(a.key) - BUNGALOW_CATEGORY_ORDER.indexOf(b.key),
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== "users") return;
    let cancelled = false;
    setUsersLoading(true);
    setUsersApiError(false);
    void (async () => {
      try {
        const [list, inv] = await Promise.all([apiListUsers(), apiListUserInvitations()]);
        if (cancelled) return;
        if (list !== null) {
          setRemoteUsers(list);
          setUsersApiError(false);
        } else {
          setRemoteUsers(null);
          setUsersApiError(true);
        }
        if (inv !== null) setPendingInvitations(inv);
        else setPendingInvitations([]);
      } catch {
        if (!cancelled) {
          setUsersApiError(true);
          setRemoteUsers(null);
          setPendingInvitations([]);
        }
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      setUsersLoading(false);
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "users" && tab !== "roles") return;
    let cancelled = false;
    if (tab === "roles") {
      setRolesLoading(true);
      setRolesApiError(false);
    }
    void (async () => {
      const list = await apiListAppUserRoles();
      if (cancelled) return;
      if (list === null) {
        setAppRoles(null);
        if (tab === "roles") setRolesApiError(true);
      } else {
        setAppRoles(list);
        if (tab === "roles") setRolesApiError(false);
      }
      if (tab === "roles") setRolesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "roles" || !userHasPermission(user, "admin.roles")) return;
    let cancelled = false;
    void (async () => {
      const cat = await apiGetPermissionCatalog();
      if (cancelled) return;
      setPermCatalog(cat);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, user]);

  useEffect(() => {
    const auditOk = userHasAnyPermission(user, ["admin.audit", "admin.sessions"]);
    const firstTab = tabs[0]?.id ?? "security";
    if (tab === "clientProfiles" && !userHasPermission(user, "directory.client_profiles")) setTab(firstTab);
    if (tab === "roles" && !userHasPermission(user, "admin.roles")) setTab(firstTab);
    if (tab === "auditLog" && !auditOk) setTab(firstTab);
    if (tab === "bungalows" && !userHasPermission(user, "lodging.bungalows")) setTab(firstTab);
    if (
      (tab === "stockArticleCategories" ||
        tab === "stockArticleUnits" ||
        tab === "stockArticleSubcategories" ||
        tab === "stockDepots") &&
      !canEditSettings
    ) {
      setTab(firstTab);
    }
  }, [user, tab, tabs, canEditSettings]);

  useEffect(() => {
    if (tab !== "roles") {
      setRolesPanel("idle");
      setRolesListQuery("");
      setEditUr(null);
    }
  }, [tab]);

  const reloadAuditLog = useCallback(async () => {
    if (!userHasPermission(user, "admin.audit")) return;
    setAuditError(false);
    setAuditLoading(true);
    const data = await apiListAuditLog(auditActorUserId ?? undefined);
    setAuditLoading(false);
    if (data === null) {
      setAuditError(true);
      setAuditEntries([]);
      return;
    }
    setAuditEntries(data);
  }, [user, auditActorUserId]);

  const reloadAdminAllSessions = useCallback(async () => {
    if (!userHasPermission(user, "admin.sessions")) return;
    setAdminSessionsLoading(true);
    const data = await apiListAdminActiveSessions();
    setAdminSessionsLoading(false);
    if (data === null) {
      setAdminAllSessions([]);
      return;
    }
    setAdminAllSessions(data);
  }, [user]);

  useEffect(() => {
    if (tab !== "auditLog" || !userHasPermission(user, "admin.audit")) return;
    void reloadAuditLog();
  }, [tab, user, reloadAuditLog]);

  useEffect(() => {
    if (tab !== "auditLog" || !userHasPermission(user, "admin.sessions")) return;
    void reloadAdminAllSessions();
  }, [tab, user, reloadAdminAllSessions]);

  useEffect(() => {
    if (tab !== "security") return;
    let cancelled = false;
    setSecuritySessionsLoading(true);
    void (async () => {
      const list = await apiListAuthSessions();
      if (cancelled) return;
      setSecuritySessionsLoading(false);
      setSecuritySessions(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "clientProfiles") return;
    let cancelled = false;
    setClientProfilesLoading(true);
    setClientProfilesError(false);
    void (async () => {
      const rows = await apiListClientProfileTypes();
      if (cancelled) return;
      setClientProfilesLoading(false);
      if (rows === null) {
        setClientProfilesError(true);
        setClientProfileTypes([]);
      } else {
        setClientProfileTypes(rows);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const submitNewClientProfile = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setNewCpErr(null);
      const code = newCpCode.trim().toLowerCase();
      if (!/^[a-z][a-z0-9_]*$/.test(code)) {
        setNewCpErr(clientProfileActionError("validation_error"));
        return;
      }
      setNewCpBusy(true);
      try {
        const res = await apiCreateClientProfileType({
          code,
          label: newCpLabel.trim(),
          hint: newCpHint.trim(),
          sortOrder: newCpSort,
          emailOptional: newCpEmailOpt,
          appliesEntryFee: newCpAppliesEntryFee,
        });
        if (!res.ok) {
          setNewCpErr(clientProfileActionError(res.code));
          return;
        }
        setClientProfileTypes((prev) =>
          [...prev.filter((p) => p.code !== res.profile.code), res.profile].sort(
            (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
          ),
        );
        setNewCpCode("");
        setNewCpLabel("");
        setNewCpHint("");
        setNewCpSort(99);
        setNewCpEmailOpt(false);
        setNewCpAppliesEntryFee(false);
      } finally {
        setNewCpBusy(false);
      }
    },
    [newCpAppliesEntryFee, newCpCode, newCpEmailOpt, newCpHint, newCpLabel, newCpSort],
  );

  const confirmDeleteClientProfile = useCallback(async () => {
    if (!delCpTarget) return;
    setDelCpErr(null);
    setDelCpBusy(true);
    try {
      const res = await apiDeleteClientProfileType(delCpTarget.code);
      if (!res.ok) {
        setDelCpErr(clientProfileActionError(res.code));
        return;
      }
      setDelCpTarget(null);
      setClientProfileTypes((prev) => prev.filter((p) => p.code !== delCpTarget.code));
    } finally {
      setDelCpBusy(false);
    }
  }, [delCpTarget]);

  /** `null` = pas de réponse API valide ; sinon tableau issu de la BDD (éventuellement vide). */
  const usersFromDatabase = remoteUsers !== null;
  const displayUsers = useMemo(() => {
    if (remoteUsers !== null) return remoteUsers;
    return [];
  }, [remoteUsers]);

  return (
    <div>
      <Breadcrumb items={[{ label: "Paramètres" }]} />
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-orange/30 bg-brand-orange/10 text-brand-cream">
            <SettingsGearIcon className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-4xl tracking-wide text-white">Paramètres du système</h1>
            <p className="mt-1 max-w-3xl text-sm text-white/45">
              Les sections se choisissent dans le <strong className="text-white/60">sous-menu Paramètres</strong> de la barre
              latérale (comme Finance, Hébergement ou Logistique). Contenu&nbsp;: bungalows, catégories bungalows,
              catégories / sous-catégories / unités article, dépôts de stock, utilisateurs, taux, tarification et apparence.
            </p>
          </div>
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
        <div className="p-4 md:p-6">
          <AnimatePresence mode="wait">
            {tab === "bungalows" && (
              <motion.div
                key="bungalows"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Gestion des bungalows</h2>
                    <p className="mt-1 text-xs text-white/40">
                      Codes, catégories et statuts — données SQLite via l’API lorsque vous êtes connecté.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={bungalowsLoading || bungalowsApiError}
                    title={bungalowsApiError ? "Impossible de joindre l’API." : undefined}
                    onClick={() => {
                      if (!bungalowsApiError) openCreateBungalow();
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-orange/35 bg-brand-orange/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cream transition-colors hover:bg-brand-orange/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                    Nouveau bungalow
                  </button>
                </div>
                {bungalowsApiError ? (
                  <p
                    className="mb-4 rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-xs text-brand-cream/95"
                    role="alert"
                  >
                    Liste des bungalows indisponible (réseau, session ou serveur). Les autres onglets restent utilisables.
                  </p>
                ) : null}
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                      <tr>
                        <th className="px-4 py-3">Code</th>
                        <th className="px-4 py-3">Libellé</th>
                        <th className="px-4 py-3">Catégorie</th>
                        <th className="px-4 py-3">Cap.</th>
                        <th className="px-4 py-3">Statut</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bungalowsLoading ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-white/45">
                            Chargement…
                          </td>
                        </tr>
                      ) : displayBungalows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-white/40">
                            Aucun bungalow en base.
                          </td>
                        </tr>
                      ) : (
                        displayBungalows.map((b) => (
                          <tr key={b.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-4 py-3 font-mono text-xs text-brand-orange/90">{b.code}</td>
                            <td className="px-4 py-3 text-white/85">{b.label}</td>
                            <td className="px-4 py-3">
                              <CategoryBadge category={b.category} />
                            </td>
                            <td className="px-4 py-3 text-white/50">{b.capacity}</td>
                            <td className="px-4 py-3 text-xs text-white/55">{b.status}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-2">
                                <Link
                                  to={`/bungalows/${b.id}`}
                                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/60 transition-colors hover:border-brand-orange/30 hover:text-brand-cream"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Fiche
                                </Link>
                                <button
                                  type="button"
                                  disabled={bungalowsApiError}
                                  onClick={() => {
                                    if (!bungalowsApiError) openEditBungalow(b);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/60 transition-colors hover:border-brand-orange/30 hover:text-brand-cream disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Modifier
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {bungalowModal
                  ? createPortal(
                      <div
                        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
                        role="presentation"
                        onClick={() => closeBungalowModal()}
                      >
                        <div
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby={`${baseId}-bungalow-form-title`}
                          className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-zinc-950 p-6 shadow-2xl ring-1 ring-black/40"
                          onClick={(e) => e.stopPropagation()}
                        >
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <h3
                          id={`${baseId}-bungalow-form-title`}
                          className="font-display text-lg tracking-wide text-brand-cream/95"
                        >
                          {bungalowModal === "create" ? "Nouveau bungalow" : "Modifier le bungalow"}
                        </h3>
                        <button
                          type="button"
                          disabled={bFormBusy}
                          onClick={() => closeBungalowModal()}
                          className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                          aria-label="Fermer"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      <form onSubmit={(e) => void submitBungalowForm(e)} className="space-y-3">
                        <div>
                          <label
                            htmlFor={`${baseId}-bf-code`}
                            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                          >
                            Code inventaire
                          </label>
                          <input
                            id={`${baseId}-bf-code`}
                            required
                            value={bfCode}
                            onChange={(e) => setBfCode(e.target.value)}
                            className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-brand-orange/35"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`${baseId}-bf-label`}
                            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                          >
                            Libellé
                          </label>
                          <input
                            id={`${baseId}-bf-label`}
                            required
                            value={bfLabel}
                            onChange={(e) => setBfLabel(e.target.value)}
                            className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`${baseId}-bf-cat`}
                              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                            >
                              Catégorie
                            </label>
                            <select
                              id={`${baseId}-bf-cat`}
                              value={bfCategory}
                              onChange={(e) => setBfCategory(e.target.value as BungalowCategory)}
                              className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                            >
                              <option value="Premium">Premium</option>
                              <option value="Deluxe">Deluxe</option>
                              <option value="Standard">Standard</option>
                            </select>
                          </div>
                          <div>
                            <label
                              htmlFor={`${baseId}-bf-status`}
                              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                            >
                              Statut
                            </label>
                            <select
                              id={`${baseId}-bf-status`}
                              value={bfStatus}
                              onChange={(e) => setBfStatus(e.target.value as BungalowStatus)}
                              className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                            >
                              {BUNGALOW_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`${baseId}-bf-rooms`}
                              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                            >
                              Pièces
                            </label>
                            <select
                              id={`${baseId}-bf-rooms`}
                              value={bfRooms}
                              onChange={(e) => setBfRooms(Number(e.target.value) as 1 | 2)}
                              className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                            >
                              <option value={1}>1</option>
                              <option value={2}>2</option>
                            </select>
                          </div>
                          <div>
                            <label
                              htmlFor={`${baseId}-bf-cap`}
                              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                            >
                              Capacité (pers.)
                            </label>
                            <select
                              id={`${baseId}-bf-cap`}
                              value={bfCapacity}
                              onChange={(e) => setBfCapacity(Number(e.target.value) as 1 | 2 | 3)}
                              className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                            >
                              <option value={1}>1</option>
                              <option value={2}>2</option>
                              <option value={3}>3</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label
                            htmlFor={`${baseId}-bf-desc`}
                            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                          >
                            Description
                          </label>
                          <textarea
                            id={`${baseId}-bf-desc`}
                            rows={3}
                            value={bfDescription}
                            onChange={(e) => setBfDescription(e.target.value)}
                            className="w-full resize-y rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`${baseId}-bf-img`}
                            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                          >
                            URL image
                          </label>
                          <input
                            id={`${baseId}-bf-img`}
                            value={bfImage}
                            onChange={(e) => setBfImage(e.target.value)}
                            className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                            placeholder="https://…"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`${baseId}-bf-am`}
                            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                          >
                            Équipements (une ligne = un item)
                          </label>
                          <textarea
                            id={`${baseId}-bf-am`}
                            rows={4}
                            value={bfAmenities}
                            onChange={(e) => setBfAmenities(e.target.value)}
                            className="w-full resize-y rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-brand-orange/35"
                          />
                        </div>
                        {bFormErr ? (
                          <p className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                            {bFormErr}
                          </p>
                        ) : null}
                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            type="button"
                            disabled={bFormBusy}
                            onClick={() => closeBungalowModal()}
                            className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:bg-white/[0.06] disabled:opacity-50"
                          >
                            Annuler
                          </button>
                          <button
                            type="submit"
                            disabled={bFormBusy}
                            className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-glow-sm disabled:opacity-50"
                          >
                            {bFormBusy ? "Enregistrement…" : bungalowModal === "create" ? "Créer" : "Mettre à jour"}
                          </button>
                        </div>
                      </form>
                        </div>
                      </div>,
                      document.body,
                    )
                  : null}
              </motion.div>
            )}

            {tab === "categories" && (
              <motion.div
                key="categories"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-4">
                  <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Catégories bungalows</h2>
                  <p className="mt-1 text-xs text-white/40">
                    Trois catégories fixes (Premium, Deluxe, Standard) — seul le libellé affiché est modifiable. Les bungalows
                    restent rattachés à l’identifiant technique (inchangé).
                  </p>
                  {categoriesError ? (
                    <p className="mt-2 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                      Impossible de charger les catégories depuis l’API.
                    </p>
                  ) : null}
                  {categoriesLoading ? (
                    <p className="mt-2 text-xs text-white/45">Chargement depuis SQLite…</p>
                  ) : null}
                  {categoriesReadOnly ? (
                    <p className="mt-2 text-[11px] text-white/35">Lecture seule — enregistrement réservé aux comptes autorisés à modifier les paramètres.</p>
                  ) : null}
                </div>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full min-w-[320px] text-left text-sm">
                    <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                      <tr>
                        <th className="px-4 py-3">Catégorie</th>
                        <th className="px-4 py-3 text-center">Bungalows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryRows.length === 0 && categoriesLoading ? (
                        <tr>
                          <td colSpan={2} className="px-4 py-10 text-center text-white/45">
                            Chargement…
                          </td>
                        </tr>
                      ) : (
                        categoryRows.map((c) => {
                          const count = displayBungalows.filter((b) => b.category === c.key).length;
                          return (
                            <tr key={c.key} className="border-b border-white/5 hover:bg-white/[0.02]">
                              <td className="px-4 py-3 align-middle">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                                  <CategoryBadge category={c.key} />
                                  <div className="min-w-0 flex-1">
                                    <label
                                      className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/35"
                                      htmlFor={`${baseId}-cat-label-${c.key}`}
                                    >
                                      Libellé affiché
                                    </label>
                                    <input
                                      id={`${baseId}-cat-label-${c.key}`}
                                      type="text"
                                      readOnly={categoriesReadOnly}
                                      value={c.label}
                                      onChange={(e) => {
                                        if (categoriesReadOnly) return;
                                        const v = e.target.value;
                                        setCategoryRows((prev) =>
                                          prev.map((row) => (row.key === c.key ? { ...row, label: v } : row)),
                                        );
                                      }}
                                      className="w-full max-w-md rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 read-only:cursor-not-allowed read-only:opacity-60 focus:border-brand-orange/40 focus:ring-2"
                                    />
                                    <p className="mt-1 font-mono text-[10px] text-white/30">Identifiant : {c.key}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center font-display text-lg text-white/90">{count}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={categoriesLoading || categoriesReadOnly || categoryRows.length < 3}
                      onClick={() => void saveCategories()}
                      className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-5 py-2.5 text-sm font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Enregistrer les libellés
                    </button>
                    {categoriesSavedFlash && (
                      <motion.span
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="text-xs text-emerald-300/90"
                      >
                        Enregistré en base SQLite.
                      </motion.span>
                    )}
                  </div>
                  {categoriesSaveErr ? (
                    <p className="text-xs text-brand-cream/90" role="alert">
                      {categoriesSaveErr}
                    </p>
                  ) : null}
                </div>
              </motion.div>
            )}

            {tab === "stockArticleCategories" && (
              <StockItemCategoriesSettingsPanel readOnly={categoriesReadOnly} baseId={baseId} />
            )}

            {tab === "stockArticleUnits" && (
              <StockItemUnitsSettingsPanel readOnly={categoriesReadOnly} baseId={baseId} />
            )}

            {tab === "stockArticleSubcategories" && (
              <StockItemSubcategoriesSettingsPanel readOnly={categoriesReadOnly} baseId={baseId} />
            )}

            {tab === "stockDepots" && (
              <StockDepotsSettingsPanel readOnly={categoriesReadOnly} baseId={baseId} />
            )}

            {tab === "users" && (
              <motion.div
                key="users"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Utilisateurs</h2>
                    <p className="mt-1 text-xs text-white/40">
                      {usersFromDatabase
                        ? "Comptes en base SQLite. Invitation : le lien sécurisé est envoyé par e-mail à la personne (SMTP configuré côté serveur). Usage unique et expiration ; le mot de passe est choisi sur la page dédiée. Les rôles avec droit « gestion des comptes » peuvent modifier ou supprimer un utilisateur — sauf leur propre compte pour supprimer ou se désactiver. Les rôles se gèrent dans l’onglet Rôles."
                        : "Liste chargée via l’API lorsque vous êtes connecté avec une session serveur (JWT)."}
                    </p>
                  </div>
                  {canInviteUser ? (
                    <button
                      type="button"
                      onClick={() => void openInvite()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-orange/35 bg-brand-orange/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cream transition-colors hover:bg-brand-orange/20"
                    >
                      <Plus className="h-4 w-4" />
                      Inviter un utilisateur
                    </button>
                  ) : null}
                </div>
                {usersApiError && (
                  <p className="mb-3 rounded-lg border border-brand-orange/25 bg-brand-orange/5 px-3 py-2 text-xs text-brand-cream/90">
                    Impossible de charger la liste des utilisateurs (réseau, session ou droits insuffisants).
                  </p>
                )}
                {toggleActiveErr ? (
                  <p
                    className="mb-3 rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95"
                    role="alert"
                  >
                    {toggleActiveErr}
                  </p>
                ) : null}
                {canInviteUser && usersFromDatabase && !usersLoading && pendingInvitations.length > 0 && (
                  <div className="mb-4 overflow-x-auto rounded-xl border border-brand-orange/25 bg-brand-orange/[0.07]">
                    <div className="border-b border-white/10 px-4 py-2.5">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-brand-orange/90">
                        Invitations en attente
                      </h3>
                      <p className="mt-0.5 text-[11px] text-white/40">
                        Liens non utilisés. Révoquez si l’e-mail était erroné ou pour forcer un nouveau jeton.
                      </p>
                    </div>
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        <tr>
                          <th className="px-4 py-2">Nom</th>
                          <th className="px-4 py-2">E-mail</th>
                          <th className="px-4 py-2">Rôle</th>
                          <th className="px-4 py-2">Expire</th>
                          <th className="px-4 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingInvitations.map((inv) => (
                          <tr key={inv.id} className="border-b border-white/5">
                            <td className="px-4 py-2 font-medium text-white/85">{inv.name}</td>
                            <td className="px-4 py-2 text-white/50">{inv.email}</td>
                            <td className="px-4 py-2">
                              <span
                                className={`inline-flex max-w-[14rem] break-words rounded-md border px-2 py-0.5 text-[10px] font-semibold leading-snug sm:text-[11px] ${roleBadgeClass(inv.role, appRoles)}`}
                              >
                                {inv.role}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-xs text-white/45">
                              {new Date(inv.expiresAt).toLocaleString("fr-FR", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <button
                                type="button"
                                disabled={inviteRevokeBusy === inv.id}
                                onClick={() => void revokePendingInvite(inv.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-brand-red/25 px-2 py-1 text-[11px] text-brand-red/90 transition-colors hover:bg-brand-red/15 hover:text-brand-cream disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Révoquer
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                      <tr>
                        <th className="px-4 py-3">Nom</th>
                        <th className="px-4 py-3">E-mail</th>
                        <th className="px-4 py-3">Rôle</th>
                        <th className="px-4 py-3">État</th>
                        <th className="px-4 py-3">Créé le</th>
                        <th className="px-4 py-3">Modifié le</th>
                        <th className="px-4 py-3">Dernière connexion</th>
                        <th className="px-4 py-3">2FA</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersLoading && (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center text-sm text-white/40">
                            Chargement des utilisateurs…
                          </td>
                        </tr>
                      )}
                      {!usersLoading &&
                        usersFromDatabase &&
                        displayUsers.length === 0 && (
                          <tr>
                            <td colSpan={9} className="px-4 py-10 text-center text-sm text-white/40">
                              Aucun utilisateur en base.
                            </td>
                          </tr>
                        )}
                      {!usersLoading &&
                        displayUsers.map((u) => (
                        <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="px-4 py-3 font-medium text-white/90">{u.name}</td>
                          <td className="px-4 py-3 text-white/50">{u.email}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex max-w-[14rem] break-words rounded-md border px-2 py-0.5 text-[10px] font-semibold leading-snug sm:text-[11px] ${roleBadgeClass(u.role, appRoles)}`}
                            >
                              {u.role}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-xs font-medium ${u.active ? "text-emerald-300/90" : "text-white/35"}`}
                            >
                              {u.active ? "Actif" : "Inactif"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-white/45">
                            {u.createdAt
                              ? new Date(u.createdAt).toLocaleString("fr-FR", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-white/45">
                            {u.updatedAt
                              ? new Date(u.updatedAt).toLocaleString("fr-FR", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-white/45">
                            {u.lastLoginAt
                              ? new Date(u.lastLoginAt).toLocaleString("fr-FR", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-white/55">{u.totpEnabled ? "Oui" : "—"}</td>
                          <td className="px-4 py-3 text-right">
                            {canManageUserRecords ? (
                              <div className="flex flex-wrap items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEdit(u)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/60 transition-colors hover:border-brand-orange/30 hover:text-brand-cream"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Modifier
                                </button>
                                {u.id !== user?.id ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleActive(u)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/60 transition-colors hover:border-white/25 hover:text-brand-cream"
                                  >
                                    {u.active ? "Désactiver" : "Activer"}
                                  </button>
                                ) : null}
                                {u.id !== user?.id ? (
                                  <button
                                    type="button"
                                    onClick={() => openDeleteConfirm(u)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-brand-red/25 px-2 py-1 text-[11px] text-brand-red/90 transition-colors hover:bg-brand-red/15 hover:text-brand-cream"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Supprimer
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-[11px] text-white/25">—</span>
                            )}
                          </td>
                        </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {inviteOpen && (
                  <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
                    role="presentation"
                    onClick={() => {
                      if (!inviteBusy) setInviteOpen(false);
                    }}
                  >
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby={`${baseId}-invite-title`}
                      className="glass-panel w-full max-w-md rounded-2xl border border-white/10 p-6 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <h3 id={`${baseId}-invite-title`} className="font-display text-lg tracking-wide text-brand-cream/95">
                          {inviteDone ? "Invitation envoyée" : "Inviter un collaborateur"}
                        </h3>
                        <button
                          type="button"
                          disabled={inviteBusy}
                          onClick={() => setInviteOpen(false)}
                          className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                          aria-label="Fermer"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      {inviteDone ? (
                        <div className="space-y-3">
                          <p className="text-sm text-white/65">
                            Un e-mail avec le lien d’activation a été envoyé à{" "}
                            <span className="break-all font-medium text-brand-cream/90">{inviteDone.email}</span>.
                            Invitation valide jusqu’au{" "}
                            <span className="text-brand-cream/90">
                              {new Date(inviteDone.expiresAt).toLocaleString("fr-FR", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </span>
                            .
                          </p>
                          <p className="text-xs text-white/40">
                            En cas de courrier indésirable, demandez à la personne de vérifier ses spams.
                          </p>
                          <div className="flex justify-end pt-2">
                            <button
                              type="button"
                              onClick={() => setInviteOpen(false)}
                              className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-glow-sm"
                            >
                              Terminé
                            </button>
                          </div>
                        </div>
                      ) : (
                        <form onSubmit={submitInvite} className="space-y-3">
                          <p className="text-xs text-white/45">
                            Aucun mot de passe ici : le collaborateur le choisit en ouvrant le lien.
                          </p>
                          <div>
                            <label
                              htmlFor={`${baseId}-nv-name`}
                              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                            >
                              Nom
                            </label>
                            <input
                              id={`${baseId}-nv-name`}
                              required
                              value={nvName}
                              onChange={(e) => setNvName(e.target.value)}
                              className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`${baseId}-nv-email`}
                              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                            >
                              E-mail
                            </label>
                            <input
                              id={`${baseId}-nv-email`}
                              type="email"
                              required
                              autoComplete="off"
                              value={nvEmail}
                              onChange={(e) => setNvEmail(e.target.value)}
                              className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                            />
                          </div>
                          {canAssignRoles ? (
                            <div>
                              <label
                                htmlFor={`${baseId}-nv-role`}
                                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                              >
                                Rôle
                              </label>
                              <select
                                id={`${baseId}-nv-role`}
                                value={nvRole}
                                onChange={(e) => setNvRole(e.target.value)}
                                className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                              >
                                {(appRoles ?? []).map((r) => (
                                  <option key={r.id} value={r.label}>
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (appRoles ?? []).filter((r) => r.allowNonAdminInvite).length > 1 ? (
                            <div>
                              <label
                                htmlFor={`${baseId}-nv-role-na`}
                                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                              >
                                Rôle (limité)
                              </label>
                              <select
                                id={`${baseId}-nv-role-na`}
                                value={nvRole}
                                onChange={(e) => setNvRole(e.target.value)}
                                className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                              >
                                {(appRoles ?? [])
                                  .filter((r) => r.allowNonAdminInvite)
                                  .map((r) => (
                                    <option key={r.id} value={r.label}>
                                      {r.label}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          ) : (
                            <p className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/55">
                              Rôle de l’invité :{" "}
                              <strong className="text-white/85">
                                {(appRoles ?? []).find((r) => r.allowNonAdminInvite)?.label ?? "—"}
                              </strong>
                              . Pour les autres rôles, un administrateur application doit envoyer l’invitation.
                            </p>
                          )}
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
                            <input
                              type="checkbox"
                              checked={nvActive}
                              onChange={(e) => setNvActive(e.target.checked)}
                              className="rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                            />
                            Compte actif après acceptation
                          </label>
                          {inviteErr ? (
                            <p
                              className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95"
                              role="alert"
                            >
                              {inviteErr}
                            </p>
                          ) : null}
                          <div className="flex justify-end gap-2 pt-2">
                            <button
                              type="button"
                              disabled={inviteBusy}
                              onClick={() => setInviteOpen(false)}
                              className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:bg-white/[0.06] disabled:opacity-50"
                            >
                              Annuler
                            </button>
                            <button
                              type="submit"
                              disabled={inviteBusy}
                              className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-glow-sm disabled:opacity-50"
                            >
                              {inviteBusy ? "Génération…" : "Générer le lien"}
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </div>
                )}
                {editUser && (
                  <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
                    role="presentation"
                    onClick={() => {
                      if (!editBusy) setEditUser(null);
                    }}
                  >
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby={`${baseId}-edit-title`}
                      className="glass-panel w-full max-w-md rounded-2xl border border-white/10 p-6 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <h3 id={`${baseId}-edit-title`} className="font-display text-lg tracking-wide text-brand-cream/95">
                          Modifier l’utilisateur
                        </h3>
                        <button
                          type="button"
                          disabled={editBusy}
                          onClick={() => setEditUser(null)}
                          className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                          aria-label="Fermer"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      <form onSubmit={submitEdit} className="space-y-3">
                        <div>
                          <label htmlFor={`${baseId}-ed-name`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                            Nom
                          </label>
                          <input
                            id={`${baseId}-ed-name`}
                            required
                            value={edName}
                            onChange={(e) => setEdName(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                          />
                        </div>
                        <div>
                          <label htmlFor={`${baseId}-ed-email`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                            E-mail
                          </label>
                          <input
                            id={`${baseId}-ed-email`}
                            type="email"
                            required
                            autoComplete="off"
                            value={edEmail}
                            onChange={(e) => setEdEmail(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                          />
                        </div>
                        <div>
                          <label htmlFor={`${baseId}-ed-pass`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                            Nouveau mot de passe (optionnel, min. 8 caractères)
                          </label>
                          <input
                            id={`${baseId}-ed-pass`}
                            type="password"
                            autoComplete="new-password"
                            value={edPassword}
                            onChange={(e) => setEdPassword(e.target.value)}
                            placeholder="Laisser vide pour ne pas changer"
                            className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-brand-orange/35"
                          />
                        </div>
                        {canAssignRoles ? (
                          <div>
                            <label htmlFor={`${baseId}-ed-role`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                              Rôle
                            </label>
                            <select
                              id={`${baseId}-ed-role`}
                              value={edRole}
                              onChange={(e) => setEdRole(e.target.value)}
                              className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/35"
                            >
                              {(appRoles ?? []).map((r) => (
                                <option key={r.id} value={r.label}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">Rôle</p>
                            <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/80">
                              <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${roleBadgeClass(editUser.role, appRoles)}`}>
                                {editUser.role}
                              </span>
                              <span className="ml-2 text-xs text-white/45">— modifiable par un administrateur.</span>
                            </p>
                          </div>
                        )}
                        <div>
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
                            <input
                              type="checkbox"
                              checked={edActive}
                              disabled={editUser.id === user?.id}
                              onChange={(e) => setEdActive(e.target.checked)}
                              className="rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40 disabled:opacity-50"
                            />
                            Compte actif
                          </label>
                          {editUser.id === user?.id ? (
                            <p className="mt-1 text-[10px] text-white/35">Vous ne pouvez pas désactiver votre propre compte.</p>
                          ) : null}
                        </div>
                        {canManageUserRecords && posAssignOptions.length > 0 ? (
                          <fieldset className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                              Caisses comptoir assignées
                            </legend>
                            <p className="mb-2 text-[11px] text-white/35">
                              Détermine quelles caisses buvette / boutique ce compte peut utiliser et voir (hors
                              supervision trésorerie).
                            </p>
                            <ul className="max-h-40 space-y-2 overflow-y-auto pr-1">
                              {posAssignOptions.map((p) => (
                                <li key={p.id}>
                                  <label className="flex cursor-pointer items-start gap-2 text-sm text-white/75">
                                    <input
                                      type="checkbox"
                                      checked={edPointOfSaleIds.includes(p.id)}
                                      disabled={editBusy}
                                      onChange={(e) => {
                                        const on = e.target.checked;
                                        setEdPointOfSaleIds((prev) =>
                                          on ? [...prev, p.id] : prev.filter((x) => x !== p.id),
                                        );
                                      }}
                                      className="mt-0.5 rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                                    />
                                    <span>
                                      {p.label}{" "}
                                      <span className="text-[11px] text-white/40">({p.code})</span>
                                      {!p.active ? (
                                        <span className="ml-1 text-[10px] text-amber-200/80">inactive</span>
                                      ) : null}
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          </fieldset>
                        ) : null}
                        {editErr ? (
                          <p className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                            {editErr}
                          </p>
                        ) : null}
                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            type="button"
                            disabled={editBusy}
                            onClick={() => setEditUser(null)}
                            className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:bg-white/[0.06] disabled:opacity-50"
                          >
                            Annuler
                          </button>
                          <button
                            type="submit"
                            disabled={editBusy}
                            className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-glow-sm disabled:opacity-50"
                          >
                            {editBusy ? "Enregistrement…" : "Enregistrer"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
                {deleteTarget && (
                  <div
                    className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
                    role="presentation"
                    onClick={() => cancelDeleteConfirm()}
                  >
                    <div
                      role="alertdialog"
                      aria-modal="true"
                      aria-labelledby={`${baseId}-del-title`}
                      aria-describedby={`${baseId}-del-desc`}
                      className="glass-panel w-full max-w-md rounded-2xl border border-brand-red/30 bg-black/50 p-6 shadow-2xl shadow-black/50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="mb-4 flex gap-3">
                        <div
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-orange/35 bg-brand-red/20"
                          aria-hidden
                        >
                          <AlertTriangle className="h-5 w-5 text-brand-orange" />
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <h3 id={`${baseId}-del-title`} className="font-display text-lg tracking-wide text-brand-cream/95">
                            Supprimer le compte&nbsp;?
                          </h3>
                          <p id={`${baseId}-del-desc`} className="mt-2 text-sm leading-relaxed text-white/55">
                            Effacement <strong className="font-medium text-brand-cream/85">définitif</strong> en base du
                            compte{" "}
                            <span className="break-all font-medium text-brand-cream/90">« {deleteTarget.email} »</span>
                            &nbsp;: pas de corbeille, pas de récupération (distinct de la désactivation du compte).
                            <span className="mt-2 block text-white/40">Cette action est irréversible.</span>
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={deleteBusy}
                          onClick={cancelDeleteConfirm}
                          className="h-9 shrink-0 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                          aria-label="Fermer"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      {deleteErr ? (
                        <p className="mb-4 rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                          {deleteErr}
                        </p>
                      ) : null}
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          disabled={deleteBusy}
                          onClick={cancelDeleteConfirm}
                          className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white/85 transition-colors hover:bg-white/[0.1] disabled:opacity-50"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          disabled={deleteBusy}
                          onClick={() => void confirmDeleteUser()}
                          className="rounded-xl border border-brand-red/45 bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:opacity-50"
                        >
                          {deleteBusy ? "Suppression…" : "Supprimer"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {tab === "fx" && (
              <motion.div
                key="fx"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-4">
                  <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Taux de change</h2>
                  <p className="mt-1 text-xs text-white/40">
                    Référence interne <strong className="text-white/55">CDF → USD</strong> (franc congolais / dollar US) pour
                    encaissements, conversions d’affichage ou rapprochement comptable. À synchroniser avec votre banque ou la
                    source officielle que vous utilisez.
                  </p>
                  {pricingDbError ? (
                    <p className="mt-2 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                      Impossible de charger le taux depuis l’API (session ou serveur). Vérifiez que le serveur tourne et que vous
                      êtes connecté.
                    </p>
                  ) : null}
                  {pricingDbLoading ? (
                    <p className="mt-2 text-xs text-white/45">Chargement depuis SQLite…</p>
                  ) : null}
                </div>
                <div className="glass-panel max-w-xl rounded-2xl border border-white/10 p-5">
                  <label htmlFor={`${baseId}-cdf-usd`} className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    CDF pour 1 USD
                  </label>
                  <div className="flex flex-wrap items-end gap-3">
                    <input
                      id={`${baseId}-cdf-usd`}
                      type="number"
                      min={1}
                      step={1}
                      readOnly={pricingReadOnly}
                      value={cdfPerUsd}
                      onChange={(e) => {
                        if (pricingReadOnly) return;
                        setCdfPerUsd(Math.max(1, Number(e.target.value) || 0));
                      }}
                      className="w-40 rounded-xl border border-white/15 bg-black/30 px-4 py-3 font-mono text-lg text-white outline-none ring-brand-orange/40 read-only:cursor-not-allowed read-only:opacity-60 focus:border-brand-orange/40 focus:ring-2"
                    />
                    <span className="pb-3 text-sm text-white/50">FC / $</span>
                  </div>
                  {pricingReadOnly ? (
                    <p className="mt-2 text-[11px] text-white/35">Lecture seule — modification réservée aux comptes autorisés.</p>
                  ) : null}
                  <dl className="mt-6 space-y-2 border-t border-white/10 pt-4 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-white/45">1 USD vaut</dt>
                      <dd className="font-medium text-brand-cream/90">
                        {cdfPerUsd.toLocaleString("fr-CD")} CDF
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-white/45">1 CDF vaut</dt>
                      <dd className="font-mono text-brand-cream/90">
                        {(1 / Math.max(1, cdfPerUsd)).toLocaleString("fr-FR", { maximumFractionDigits: 6 })} USD
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={pricingDbLoading || pricingReadOnly}
                      onClick={() => void saveFx()}
                      className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-5 py-2.5 text-sm font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Enregistrer le taux
                    </button>
                    {fxSavedFlash && (
                      <motion.span
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="text-xs text-emerald-300/90"
                      >
                        Enregistré en base SQLite.
                      </motion.span>
                    )}
                  </div>
                  {fxSaveErr ? (
                    <p className="text-xs text-brand-cream/90" role="alert">
                      {fxSaveErr}
                    </p>
                  ) : null}
                </div>
              </motion.div>
            )}

            {tab === "pricing" && (
              <motion.div
                key="pricing"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-4">
                  <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Tarification</h2>
                  <p className="mt-1 text-xs text-white/40">
                    Prix par nuit par catégorie de bungalow et tarifs du droit d’entrée visiteur (adulte / mineur), en dollars US
                    ($), stockés dans SQLite. Les taxes pourront s’ajouter côté facturation.
                  </p>
                  {pricingDbError ? (
                    <p className="mt-2 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                      Impossible de charger la tarification depuis l’API.
                    </p>
                  ) : null}
                  {pricingDbLoading ? (
                    <p className="mt-2 text-xs text-white/45">Chargement depuis SQLite…</p>
                  ) : null}
                  {pricingReadOnly ? (
                    <p className="mt-2 text-[11px] text-white/35">Lecture seule — enregistrement réservé aux comptes autorisés à modifier les paramètres.</p>
                  ) : null}
                </div>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full min-w-[360px] text-left text-sm">
                    <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                      <tr>
                        <th className="px-4 py-3">Catégorie</th>
                        <th className="px-4 py-3">PRIX / NUITE ($)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rates.length === 0 && pricingDbLoading ? (
                        <tr>
                          <td colSpan={2} className="px-4 py-10 text-center text-white/45">
                            Chargement…
                          </td>
                        </tr>
                      ) : (
                        rates.map((r) => (
                          <tr key={r.category} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-4 py-3 align-middle">
                              <CategoryBadge category={r.category} />
                            </td>
                            <td className="px-4 py-3">
                              <label className="sr-only" htmlFor={`${baseId}-price-${r.category}`}>
                                PRIX / NUITE {r.category}
                              </label>
                              <input
                                id={`${baseId}-price-${r.category}`}
                                type="number"
                                min={0}
                                step={1}
                                readOnly={pricingReadOnly}
                                value={r.pricePerNightUSD}
                                onChange={(e) => updateRate(r.category, Number(e.target.value) || 0)}
                                className="w-32 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 read-only:cursor-not-allowed read-only:opacity-60 focus:border-brand-orange/40 focus:ring-2"
                              />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-4">
                  <h3 className="text-sm font-semibold text-brand-cream/90">Droit d’entrée visiteur</h3>
                  <p className="mt-1 text-[11px] text-white/40">
                    Tarifs unitaires en $ (USD) : passage individuel = 1 × adulte ; groupe ou famille = (adultes × tarif
                    adulte) + (mineurs × tarif mineur). Préremplissage des fiches ; modifiable par fiche si besoin.
                  </p>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div>
                      <label htmlFor={`${baseId}-visitor-entry-adult`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/45">
                        Adulte ($ / pers.)
                      </label>
                      <input
                        id={`${baseId}-visitor-entry-adult`}
                        type="number"
                        min={1}
                        step={1}
                        readOnly={pricingReadOnly}
                        value={visitorEntryAdultUsd}
                        onChange={(e) => setVisitorEntryAdultUsd(Number(e.target.value) || 0)}
                        className="w-36 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 read-only:cursor-not-allowed read-only:opacity-60 focus:border-brand-orange/40 focus:ring-2"
                      />
                    </div>
                    <div>
                      <label htmlFor={`${baseId}-visitor-entry-minor`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/45">
                        Mineur ($ / pers.)
                      </label>
                      <input
                        id={`${baseId}-visitor-entry-minor`}
                        type="number"
                        min={1}
                        step={1}
                        readOnly={pricingReadOnly}
                        value={visitorEntryMinorUsd}
                        onChange={(e) => setVisitorEntryMinorUsd(Number(e.target.value) || 0)}
                        className="w-36 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 read-only:cursor-not-allowed read-only:opacity-60 focus:border-brand-orange/40 focus:ring-2"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-4">
                  <h3 className="text-sm font-semibold text-brand-cream/90">Retard d’occupation</h3>
                  <p className="mt-1 text-[11px] text-white/40">
                    Si une réservation est <strong className="text-white/55">confirmée</strong> mais que le client ne prend
                    pas possession du logement dans les <strong className="text-white/55">jours calendaires</strong> suivant
                    le début du séjour (1 à 5 jours, réglables ici), vous pouvez lui appliquer la pénalité depuis la page{" "}
                    <strong className="text-white/55">Réservations</strong>. Le montant dû pour l’acompte / la confirmation
                    inclut alors séjour + pénalité.
                  </p>
                  <div className="mt-3 flex flex-wrap items-end gap-4">
                    <div>
                      <label
                        htmlFor={`${baseId}-occupancy-grace`}
                        className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/45"
                      >
                        Délai max (jours)
                      </label>
                      <input
                        id={`${baseId}-occupancy-grace`}
                        type="number"
                        min={1}
                        max={5}
                        step={1}
                        readOnly={pricingReadOnly}
                        value={occupancyGraceDays}
                        onChange={(e) => setOccupancyGraceDays(Number(e.target.value) || 1)}
                        className="w-28 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 read-only:cursor-not-allowed read-only:opacity-60 focus:border-brand-orange/40 focus:ring-2"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`${baseId}-occupancy-penalty`}
                        className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/45"
                      >
                        Pénalité ($)
                      </label>
                      <input
                        id={`${baseId}-occupancy-penalty`}
                        type="number"
                        min={0}
                        step={1}
                        readOnly={pricingReadOnly}
                        value={occupancyPenaltyUsd}
                        onChange={(e) => setOccupancyPenaltyUsd(Number(e.target.value) || 0)}
                        className="w-36 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 read-only:cursor-not-allowed read-only:opacity-60 focus:border-brand-orange/40 focus:ring-2"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={
                        pricingDbLoading ||
                        pricingReadOnly ||
                        rates.length < 3 ||
                        Math.floor(visitorEntryAdultUsd) < 1 ||
                        Math.floor(visitorEntryMinorUsd) < 1 ||
                        Math.floor(occupancyGraceDays) < 1 ||
                        Math.floor(occupancyGraceDays) > 5 ||
                        Math.floor(occupancyPenaltyUsd) < 0
                      }
                      onClick={() => void saveRates()}
                      className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-5 py-2.5 text-sm font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Enregistrer la tarification
                    </button>
                    {ratesSavedFlash && (
                      <motion.span
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="text-xs text-emerald-300/90"
                      >
                        Enregistré en base SQLite.
                      </motion.span>
                    )}
                  </div>
                  {ratesSaveErr ? (
                    <p className="text-xs text-brand-cream/90" role="alert">
                      {ratesSaveErr}
                    </p>
                  ) : null}
                </div>
              </motion.div>
            )}

            {tab === "roles" && (
              <motion.div
                key="roles"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-4">
                  <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Rôles utilisateurs</h2>
                  {rolesOverview && !rolesLoading ? (
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
                      <span className="inline-flex items-center gap-1.5">
                        <LayoutList className="h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
                        <span>
                          {rolesOverview.total} rôle{rolesOverview.total === 1 ? "" : "s"}
                          {rolesListQuery.trim()
                            ? ` · ${filteredAppRoles.length} affiché${filteredAppRoles.length === 1 ? "" : "s"}`
                            : ""}
                          {rolesOverview.adminCount > 0
                            ? ` · ${rolesOverview.adminCount} admin app.`
                            : ""}
                          {rolesOverview.systemCount > 0
                            ? ` · ${rolesOverview.systemCount} système`
                            : ""}
                        </span>
                      </span>
                      <span className="text-white/30">·</span>
                      <span className="text-white/38">Choisissez un rôle pour éditer la matrice ; la liste reste visible en haut à gauche sur grand écran.</span>
                    </p>
                  ) : null}
                  <details className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    <summary className="cursor-pointer select-none text-xs font-semibold text-white/50 outline-none marker:text-white/40 hover:text-white/70">
                      Guide RBAC et bonnes pratiques
                    </summary>
                    <div className="mt-2 border-t border-white/5 pt-2">
                      <p className="text-xs text-white/40">
                        Modèle <strong className="text-white/55">RBAC</strong> : un utilisateur a un <strong className="text-white/55">rôle</strong> ; le rôle reçoit des{" "}
                        <strong className="text-white/55">permissions</strong> (codes stables). L’
                        <strong className="text-white/55">administrateur application</strong> ignore la matrice (tout accès).{" "}
                        <strong className="text-white/55">Invitation non-admin</strong> : rôles qu’un invitant peut choisir sans le droit « invitation sans restriction ».{" "}
                        Rôles <strong className="text-white/55">système</strong> : non renommables / non supprimables.
                      </p>
                      <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-white/38">
                        <li>Principe du moindre privilège : ne cochez que le nécessaire.</li>
                        <li>Les changements de rôle des utilisateurs sont tracés côté serveur ; modifiez la matrice avec prudence en production.</li>
                        <li>
                          La matrice suit le menu : un seul libellé = une case ; utilisez « Tout / Aucun » pour un bloc
                          entier si besoin.
                        </li>
                      </ul>
                    </div>
                  </details>
                  {rolesApiError ? (
                    <p className="mt-2 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                      Impossible de charger les rôles depuis l’API.
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] lg:items-stretch">
                  <aside className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-white/[0.02] p-3 md:p-4 lg:sticky lg:top-4 lg:max-h-[min(85vh,760px)] lg:self-start">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-stretch">
                      <label htmlFor={`${baseId}-ur-list-filter`} className="sr-only">
                        Filtrer les rôles par libellé
                      </label>
                      <input
                        id={`${baseId}-ur-list-filter`}
                        type="search"
                        value={rolesListQuery}
                        onChange={(e) => setRolesListQuery(e.target.value)}
                        disabled={rolesLoading}
                        placeholder="Filtrer par libellé…"
                        autoComplete="off"
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/25 focus:ring-2 disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => startNewAppRole()}
                        disabled={rolesLoading}
                        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-brand-orange/40 bg-brand-orange/15 px-3 py-2 text-xs font-semibold text-brand-cream transition-colors hover:bg-brand-orange/25 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Nouveau rôle
                      </button>
                    </div>
                    <nav
                      className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5 lg:max-h-[min(70vh,620px)]"
                      aria-label="Liste des rôles"
                    >
                      {rolesLoading ? (
                        <p className="py-8 text-center text-sm text-white/45">Chargement…</p>
                      ) : (appRoles ?? []).length === 0 ? (
                        <p className="py-8 text-center text-sm text-white/40">Aucun rôle (vérifiez la base ou l’API).</p>
                      ) : filteredAppRoles.length === 0 ? (
                        <p className="py-8 text-center text-sm text-white/40">Aucun rôle ne correspond au filtre.</p>
                      ) : (
                        filteredAppRoles.map((row) => (
                          <div
                            key={row.id}
                            className={`rounded-lg border p-2.5 transition-colors ${
                              rolesPanel === row.id
                                ? "border-brand-orange/50 bg-brand-orange/[0.12] shadow-[inset_3px_0_0_0] shadow-brand-orange/80"
                                : "border-white/10 bg-black/20 hover:border-white/25"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                aria-current={rolesPanel === row.id ? "true" : undefined}
                                onClick={() => openEditAppRole(row)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <span
                                  className={`inline-block max-w-full break-words rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-snug sm:text-xs ${roleBadgeClass(row.label, appRoles)}`}
                                >
                                  {row.label}
                                </span>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                  <span className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] tabular-nums text-white/50">
                                    Ordre {row.sortOrder}
                                  </span>
                                  {row.isAppAdmin ? (
                                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-100/90">
                                      Admin app.
                                    </span>
                                  ) : (
                                    <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/45">
                                      {row.permissions.length} droit{row.permissions.length === 1 ? "" : "s"}
                                    </span>
                                  )}
                                  {row.isSystem ? (
                                    <span className="rounded border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/55">
                                      Système
                                    </span>
                                  ) : null}
                                  {row.allowNonAdminInvite ? (
                                    <span className="rounded border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-100/85">
                                      Invit.
                                    </span>
                                  ) : null}
                                </div>
                              </button>
                              {!row.isSystem ? (
                                <button
                                  type="button"
                                  aria-label={`Supprimer le rôle ${row.label}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDelUrErr(null);
                                    setDelUrTarget(row);
                                  }}
                                  className="shrink-0 rounded-md border border-brand-red/35 p-1.5 text-brand-red/90 transition-colors hover:bg-brand-red/15"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </nav>
                  </aside>

                  <section
                    className="flex min-h-[min(50vh,420px)] min-w-0 flex-col rounded-xl border border-white/10 bg-white/[0.02] p-4 md:p-5 lg:max-h-[min(85vh,760px)] lg:overflow-y-auto lg:overscroll-contain"
                    aria-live="polite"
                  >
                    {rolesPanel === "idle" ? (
                      <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-4 text-center">
                        <p className="max-w-sm text-sm text-white/45">
                          Sélectionnez un rôle dans la liste à gauche ou créez un nouveau rôle pour modifier la matrice des permissions.
                        </p>
                        <button
                          type="button"
                          onClick={() => startNewAppRole()}
                          disabled={rolesLoading}
                          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-brand-orange/40 bg-brand-orange/15 px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-orange/25 disabled:opacity-40"
                        >
                          <Plus className="h-4 w-4" />
                          Nouveau rôle
                        </button>
                      </div>
                    ) : null}

                    {rolesPanel === "new" ? (
                      <div>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Création</p>
                            <h3 className="mt-1 font-display text-lg tracking-wide text-brand-cream/95">Nouveau rôle</h3>
                            <p className="mt-1 max-w-xl text-xs text-white/45">
                              Même flux qu’avant : libellé, ordre, copie optionnelle de matrice, puis cases à cocher. Après création, le rôle s’ouvre ici pour affinage.
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={newUrBusy}
                            onClick={() => {
                              setRolesPanel("idle");
                              setNewUrLabel("");
                              setNewUrSort(99);
                              setNewUrAdmin(false);
                              setNewUrInvite(false);
                              setNewUrPerms([]);
                              setNewUrCloneFromId("");
                              setNewUrErr(null);
                            }}
                            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5"
                          >
                            Fermer
                          </button>
                        </div>
                        <form onSubmit={(e) => void submitNewAppRole(e)} className="grid gap-3 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <label htmlFor={`${baseId}-ur-label`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                              Libellé affiché
                            </label>
                            <input
                              id={`${baseId}-ur-label`}
                              value={newUrLabel}
                              onChange={(e) => setNewUrLabel(e.target.value)}
                              disabled={newUrBusy || rolesLoading}
                              placeholder="ex. Maintenance"
                              className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/25 focus:ring-2 disabled:opacity-50"
                              autoComplete="off"
                            />
                          </div>
                          <div>
                            <label htmlFor={`${baseId}-ur-sort`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                              Ordre d’affichage
                            </label>
                            <input
                              id={`${baseId}-ur-sort`}
                              type="number"
                              min={0}
                              max={9999}
                              value={newUrSort}
                              onChange={(e) => setNewUrSort(Number(e.target.value) || 0)}
                              disabled={newUrBusy || rolesLoading}
                              className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 disabled:opacity-50"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label htmlFor={`${baseId}-ur-clone`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                              Copier la matrice depuis…
                            </label>
                            <select
                              id={`${baseId}-ur-clone`}
                              value={newUrCloneFromId}
                              disabled={newUrBusy || rolesLoading || newUrAdmin}
                              onChange={(e) => {
                                const id = e.target.value;
                                setNewUrCloneFromId(id);
                                if (!id) return;
                                const src = (appRoles ?? []).find((r) => r.id === id);
                                if (src && !src.isAppAdmin) setNewUrPerms([...src.permissions]);
                              }}
                              className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
                            >
                              <option value="">— Matrice vide (à cocher manuellement) —</option>
                              {(appRoles ?? [])
                                .filter((r) => !r.isAppAdmin)
                                .map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.label} ({r.permissions.length} droit{r.permissions.length === 1 ? "" : "s"})
                                  </option>
                                ))}
                            </select>
                            <p className="mt-1 text-[10px] text-white/35">
                              Raccourci pour créer un rôle proche d’un existant ; ajustez ensuite la matrice.
                            </p>
                          </div>
                          <div className="flex flex-col gap-2 sm:col-span-2">
                            <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
                              <input
                                type="checkbox"
                                checked={newUrAdmin}
                                onChange={(e) => {
                                  const v = e.target.checked;
                                  setNewUrAdmin(v);
                                  if (v) {
                                    setNewUrPerms([]);
                                    setNewUrCloneFromId("");
                                  }
                                }}
                                disabled={newUrBusy || rolesLoading}
                                className="h-4 w-4 rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                              />
                              Administrateur application (tous les droits ; ignore la matrice ci-dessous)
                            </label>
                          </div>
                          <div className="sm:col-span-2 space-y-2">
                            <RolePermissionCheckboxes
                              catalog={permCatalog}
                              disabled={newUrBusy || rolesLoading}
                              adminRole={newUrAdmin}
                              value={newUrPerms}
                              onChange={setNewUrPerms}
                            />
                          </div>
                          <div className="flex flex-col gap-2 sm:col-span-2">
                            <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
                              <input
                                type="checkbox"
                                checked={newUrInvite}
                                onChange={(e) => setNewUrInvite(e.target.checked)}
                                disabled={newUrBusy || rolesLoading}
                                className="h-4 w-4 rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                              />
                              Rôle attribuable par un invitant sans droit « invitation sans restriction »
                            </label>
                          </div>
                          {newUrErr ? (
                            <p className="sm:col-span-2 text-xs text-brand-cream/90" role="alert">
                              {newUrErr}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2 sm:col-span-2">
                            <button
                              type="submit"
                              disabled={newUrBusy || rolesLoading}
                              className="rounded-xl border border-brand-orange/40 bg-brand-orange/15 px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-orange/25 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {newUrBusy ? "Enregistrement…" : "Créer le rôle"}
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : null}

                    {rolesPanel !== "idle" && rolesPanel !== "new" && editUr && editUr.id === rolesPanel ? (
                      <div>
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Édition</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex max-w-full break-words rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-snug sm:text-xs ${roleBadgeClass(editUr.label, appRoles)}`}
                              >
                                {editUr.label}
                              </span>
                              {editUr.isSystem ? (
                                <span className="rounded border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-white/55">
                                  Système
                                </span>
                              ) : (
                                <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200/90">
                                  Personnalisable
                                </span>
                              )}
                              {editUrAdmin ? (
                                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-100/90">
                                  Admin application
                                </span>
                              ) : null}
                              {editUrInvite ? (
                                <span className="rounded border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-100/85">
                                  Invit. sans droit étendu
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 text-xs text-white/45">
                              {editUrAdmin
                                ? "Ce rôle a tous les droits : la matrice ci-dessous est ignorée par l’application."
                                : `${editUrPerms.length} permission${editUrPerms.length === 1 ? "" : "s"} dans la matrice (modifiables ci-dessous).`}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={editUrBusy}
                            onClick={() => {
                              setEditUr(null);
                              setRolesPanel("idle");
                            }}
                            className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5"
                          >
                            Fermer
                          </button>
                        </div>
                        <form onSubmit={(e) => void submitEditAppRole(e)} className="space-y-3">
                          <div>
                            <label htmlFor={`${baseId}-edur-label`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                              Libellé
                            </label>
                            <input
                              id={`${baseId}-edur-label`}
                              value={editUrLabel}
                              onChange={(e) => setEditUrLabel(e.target.value)}
                              disabled={editUrBusy || editUr.isSystem}
                              className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
                            />
                            {editUr.isSystem ? (
                              <p className="mt-1 text-[10px] text-white/35">Les rôles système ne peuvent pas être renommés.</p>
                            ) : null}
                          </div>
                          <div>
                            <label htmlFor={`${baseId}-edur-sort`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                              Ordre
                            </label>
                            <input
                              id={`${baseId}-edur-sort`}
                              type="number"
                              min={0}
                              max={9999}
                              value={editUrSort}
                              onChange={(e) => setEditUrSort(Number(e.target.value) || 0)}
                              disabled={editUrBusy}
                              className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
                            />
                          </div>
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
                            <input
                              type="checkbox"
                              checked={editUrAdmin}
                              onChange={(e) => {
                                const v = e.target.checked;
                                setEditUrAdmin(v);
                                if (v) setEditUrPerms([]);
                              }}
                              disabled={editUrBusy}
                              className="rounded border-white/20 bg-black/40 text-brand-orange"
                            />
                            Administrateur application (tous les droits)
                          </label>
                          <div className="space-y-2">
                            <RolePermissionCheckboxes
                              catalog={permCatalog}
                              disabled={editUrBusy}
                              adminRole={editUrAdmin}
                              value={editUrPerms}
                              onChange={setEditUrPerms}
                            />
                          </div>
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
                            <input
                              type="checkbox"
                              checked={editUrInvite}
                              onChange={(e) => setEditUrInvite(e.target.checked)}
                              disabled={editUrBusy}
                              className="rounded border-white/20 bg-black/40 text-brand-orange"
                            />
                            Attribuable par un invitant sans droit « invitation sans restriction »
                          </label>
                          {editUrErr ? (
                            <p className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                              {editUrErr}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap justify-end gap-2 pt-2">
                            <button
                              type="submit"
                              disabled={editUrBusy}
                              className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"
                            >
                              {editUrBusy ? "Enregistrement…" : "Enregistrer"}
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : null}
                  </section>
                </div>

                {delUrTarget ? (
                  <div
                    className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
                    role="presentation"
                    onClick={() => {
                      if (!delUrBusy) setDelUrTarget(null);
                    }}
                  >
                    <div
                      role="alertdialog"
                      aria-modal="true"
                      className="glass-panel w-full max-w-sm rounded-2xl border border-white/10 p-6 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <h3 className="font-display text-lg text-brand-cream/95">Supprimer le rôle ?</h3>
                      <p className="mt-2 text-sm text-white/55">
                        « {delUrTarget.label} » sera <strong className="text-brand-cream/80">effacé définitivement</strong>{" "}
                        de la base (pas d’archivage). Aucun utilisateur ni invitation en attente ne doit l’utiliser.
                      </p>
                      {delUrErr ? (
                        <p className="mt-3 rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                          {delUrErr}
                        </p>
                      ) : null}
                      <div className="mt-4 flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={delUrBusy}
                          onClick={() => setDelUrTarget(null)}
                          className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white/70"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          disabled={delUrBusy}
                          onClick={() => void confirmDeleteAppRole()}
                          className="rounded-xl border border-brand-red/45 bg-brand-red/20 px-4 py-2 text-xs font-semibold text-brand-cream"
                        >
                          {delUrBusy ? "Suppression…" : "Supprimer"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </motion.div>
            )}

            {tab === "clientProfiles" && (
              <motion.div
                key="clientProfiles"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-4">
                  <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Profils clients</h2>
                  <p className="mt-1 text-xs text-white/40">
                    Codes utilisés sur les fiches clients. Le{" "}
                    <span className="text-white/55">tarifs du droit d’entrée (adulte / mineur)</span> (USD) se règlent dans l’onglet
                    Tarification ; cochez ci-dessous les profils pour lesquels chaque fiche doit porter un montant d’entrée.
                  </p>
                  {clientProfilesError ? (
                    <p className="mt-2 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                      Impossible de charger les profils depuis l’API.
                    </p>
                  ) : null}
                </div>

                <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
                  <h3 className="text-sm font-semibold text-brand-cream/90">Ajouter un profil</h3>
                  <p className="mt-1 text-[11px] text-white/40">
                    Code technique stable (ex. <span className="font-mono text-white/55">groupe_scolaire</span>) — ne peut
                    pas être modifié après création.
                  </p>
                  <form onSubmit={(e) => void submitNewClientProfile(e)} className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`${baseId}-cp-code`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Code
                      </label>
                      <input
                        id={`${baseId}-cp-code`}
                        value={newCpCode}
                        onChange={(e) => setNewCpCode(e.target.value.toLowerCase())}
                        disabled={newCpBusy}
                        placeholder="ex. partenaire"
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/25 focus:ring-2 disabled:opacity-50"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label htmlFor={`${baseId}-cp-label`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Libellé affiché
                      </label>
                      <input
                        id={`${baseId}-cp-label`}
                        value={newCpLabel}
                        onChange={(e) => setNewCpLabel(e.target.value)}
                        disabled={newCpBusy}
                        placeholder="ex. Partenaire / groupe"
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/25 focus:ring-2 disabled:opacity-50"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={`${baseId}-cp-hint`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Description (fiche client)
                      </label>
                      <textarea
                        id={`${baseId}-cp-hint`}
                        rows={2}
                        value={newCpHint}
                        onChange={(e) => setNewCpHint(e.target.value)}
                        disabled={newCpBusy}
                        className="w-full resize-none rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/25 focus:ring-2 disabled:opacity-50"
                        placeholder="Courte aide affichée sous le badge profil…"
                      />
                    </div>
                    <div>
                      <label htmlFor={`${baseId}-cp-sort`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Ordre d’affichage
                      </label>
                      <input
                        id={`${baseId}-cp-sort`}
                        type="number"
                        min={0}
                        max={9999}
                        step={1}
                        value={newCpSort}
                        onChange={(e) => setNewCpSort(Number(e.target.value) || 0)}
                        disabled={newCpBusy}
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2 disabled:opacity-50"
                      />
                    </div>
                    <div className="flex flex-col gap-2 sm:col-span-2">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
                        <input
                          type="checkbox"
                          checked={newCpEmailOpt}
                          onChange={(e) => setNewCpEmailOpt(e.target.checked)}
                          disabled={newCpBusy}
                          className="h-4 w-4 rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                        />
                        E-mail facultatif (comme « passage »)
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
                        <input
                          type="checkbox"
                          checked={newCpAppliesEntryFee}
                          onChange={(e) => setNewCpAppliesEntryFee(e.target.checked)}
                          disabled={newCpBusy}
                          className="h-4 w-4 rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                        />
                        Droit d’entrée visiteur (montant $ sur chaque fiche ; référence dans Tarification)
                      </label>
                    </div>
                    {newCpErr ? (
                      <p className="sm:col-span-2 text-xs text-brand-cream/90" role="alert">
                        {newCpErr}
                      </p>
                    ) : null}
                    <div className="sm:col-span-2">
                      <button
                        type="submit"
                        disabled={newCpBusy || clientProfilesLoading}
                        className="rounded-xl border border-brand-orange/40 bg-brand-orange/15 px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-orange/25 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {newCpBusy ? "Enregistrement…" : "Ajouter le profil"}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                      <tr>
                        <th className="px-4 py-3">Code</th>
                        <th className="px-4 py-3">Libellé</th>
                        <th className="px-4 py-3">E-mail</th>
                        <th className="px-4 py-3">Entrée</th>
                        <th className="px-4 py-3">Ordre</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientProfilesLoading ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-white/45">
                            Chargement…
                          </td>
                        </tr>
                      ) : clientProfileTypes.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-white/40">
                            Aucun profil (vérifiez la base ou l’API).
                          </td>
                        </tr>
                      ) : (
                        clientProfileTypes.map((p) => (
                          <tr key={p.code} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-4 py-3 font-mono text-xs text-brand-orange/90">{p.code}</td>
                            <td className="px-4 py-3 text-white/85">{p.label}</td>
                            <td className="px-4 py-3 text-xs text-white/55">{p.emailOptional ? "Facultatif" : "Requis"}</td>
                            <td className="px-4 py-3 text-xs text-white/55">{p.appliesEntryFee ? "Oui ($)" : "—"}</td>
                            <td className="px-4 py-3 tabular-nums text-white/50">{p.sortOrder}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                title="Supprimer ce profil"
                                onClick={() => {
                                  setDelCpErr(null);
                                  setDelCpTarget(p);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-brand-red/35 bg-brand-red/10 px-2 py-1 text-[11px] font-medium text-brand-cream/90 transition-colors hover:bg-brand-red/20 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                Supprimer
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <AnimatePresence>
                  {delCpTarget ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
                      role="presentation"
                      onClick={() => {
                        if (!delCpBusy) setDelCpTarget(null);
                      }}
                    >
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby={`${baseId}-del-cp-title`}
                        className="glass-panel w-full max-w-md rounded-2xl border border-white/10 p-6 shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <h2 id={`${baseId}-del-cp-title`} className="font-display text-lg tracking-wide text-brand-cream/95">
                          Supprimer le profil « {delCpTarget.label} » ?
                        </h2>
                        <p className="mt-2 text-sm text-white/55">
                          Code <span className="font-mono text-white/70">{delCpTarget.code}</span>. Suppression{" "}
                          <strong className="text-brand-cream/80">définitive</strong> en base (pas de corbeille). Aucun
                          client ne doit encore utiliser ce profil.
                        </p>
                        {delCpErr ? (
                          <p className="mt-3 text-xs text-brand-cream/90" role="alert">
                            {delCpErr}
                          </p>
                        ) : null}
                        <div className="mt-5 flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={delCpBusy}
                            onClick={() => setDelCpTarget(null)}
                            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:bg-white/10 disabled:opacity-40"
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            disabled={delCpBusy}
                            onClick={() => void confirmDeleteClientProfile()}
                            className="rounded-lg border border-brand-red/40 bg-brand-red/15 px-4 py-2 text-sm font-medium text-brand-cream hover:bg-brand-red/25 disabled:opacity-40"
                          >
                            {delCpBusy ? "Suppression…" : "Supprimer"}
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            )}

            {tab === "auditLog" && (
              <motion.div
                key="auditLog"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Journal d’audit</h2>
                    <p className="mt-1 text-xs text-white/40">
                      Connexions actives de tous les comptes, puis traçabilité des opérations (liste limitée aux
                      entrées récentes).
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={auditLoading || adminSessionsLoading}
                    onClick={() => {
                      if (userHasPermission(user, "admin.audit")) void reloadAuditLog();
                      if (userHasPermission(user, "admin.sessions")) void reloadAdminAllSessions();
                    }}
                    className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-brand-cream/90 transition-colors hover:border-brand-orange/35 hover:bg-white/10 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${auditLoading || adminSessionsLoading ? "animate-spin" : ""}`}
                      aria-hidden
                    />
                    Actualiser
                  </button>
                </div>

                {userHasPermission(user, "admin.sessions") ? (
                <section className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
                  <h3 className="text-sm font-semibold text-brand-cream/90">Utilisateurs connectés</h3>
                  <p className="mt-1 text-xs text-white/40">
                    Sessions actives (cookie valide, non révoquées). Révoquer déconnecte immédiatement l’appareil
                    concerné.
                  </p>
                  <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        <tr>
                          <th className="px-3 py-2">Utilisateur</th>
                          <th className="px-3 py-2">Rôle</th>
                          <th className="px-3 py-2">Dernière activité</th>
                          <th className="px-3 py-2">IP</th>
                          <th className="px-3 py-2">Navigateur</th>
                          <th className="px-3 py-2">Expire</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminSessionsLoading && !adminAllSessions ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-8 text-center text-white/40">
                              Chargement…
                            </td>
                          </tr>
                        ) : !adminAllSessions || adminAllSessions.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-8 text-center text-white/40">
                              Aucune session active enregistrée.
                            </td>
                          </tr>
                        ) : (
                          adminAllSessions.map((s) => (
                            <tr key={s.id} className="border-b border-white/5">
                              <td className="px-3 py-2">
                                <span className="font-medium text-white/85">{s.userName}</span>
                                <span className="mt-0.5 block text-[11px] text-white/40">{s.userEmail}</span>
                              </td>
                              <td className="px-3 py-2 text-xs text-white/55">{s.userRole}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-white/60">
                                {new Date(s.lastSeenAt).toLocaleString("fr-FR", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-white/50">{s.ip || "—"}</td>
                              <td
                                className="max-w-[200px] truncate px-3 py-2 text-xs text-white/45"
                                title={s.userAgent}
                              >
                                {s.userAgent || "—"}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-white/50">
                                {new Date(s.expiresAt).toLocaleString("fr-FR", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex flex-wrap items-center justify-end gap-1">
                                  {userHasPermission(user, "admin.audit") ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAuditActorUserId(s.userId);
                                      setAuditActorLabel(s.userName);
                                    }}
                                    className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/65 hover:border-brand-orange/35 hover:text-brand-cream"
                                  >
                                    Historique
                                  </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const r = await apiAdminRevokeSession(s.id);
                                      if (!r.ok) return;
                                      void reloadAdminAllSessions();
                                    }}
                                    className="rounded-lg border border-brand-red/30 px-2 py-1 text-[11px] text-brand-red/90 hover:bg-brand-red/10"
                                  >
                                    Révoquer
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                ) : (
                  <p className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-white/45">
                    Votre rôle ne permet pas d’afficher les sessions de tous les utilisateurs.
                  </p>
                )}

                {userHasPermission(user, "admin.audit") && auditActorUserId ? (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-orange/25 bg-brand-orange/[0.08] px-4 py-3 text-sm">
                    <p className="text-white/75">
                      Filtre journal&nbsp;: actions de{" "}
                      <strong className="text-brand-cream/95">{auditActorLabel ?? auditActorUserId}</strong>
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setAuditActorUserId(null);
                        setAuditActorLabel(null);
                      }}
                      className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
                    >
                      Tout afficher
                    </button>
                  </div>
                ) : null}

                {userHasPermission(user, "admin.audit") ? (
                  <>
                {auditError ? (
                  <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100/90">
                    Impossible de charger le journal (droits insuffisants, session expirée ou erreur réseau).
                  </div>
                ) : null}
                <div className="overflow-hidden rounded-xl border border-white/10">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[920px] text-left text-sm">
                      <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        <tr>
                          <th className="px-4 py-3">Date / heure</th>
                          <th className="px-4 py-3">Action</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3 font-mono text-[10px] normal-case tracking-normal">ID cible</th>
                          <th className="px-4 py-3">Détail</th>
                          <th className="px-4 py-3">Acteur</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLoading && auditEntries === null ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-12 text-center text-white/40">
                              Chargement…
                            </td>
                          </tr>
                        ) : !auditEntries || auditEntries.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-12 text-center text-white/40">
                              Aucune entrée à afficher.
                            </td>
                          </tr>
                        ) : (
                          auditEntries.map((e) => (
                            <tr key={e.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                              <td className="whitespace-nowrap px-4 py-3 text-xs text-white/55">{formatAuditAt(e.at)}</td>
                              <td className="px-4 py-3">
                                <span className="inline-flex rounded-md border border-white/10 bg-black/25 px-2 py-0.5 text-[11px] font-medium text-brand-cream/85">
                                  {auditActionLabel(e.action)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs text-white/70">{auditEntityKindLabel(e.entityType)}</td>
                              <td className="px-4 py-3 font-mono text-[11px] text-white/45">{e.entityId}</td>
                              <td className="max-w-md px-4 py-3 text-xs leading-snug text-white/60">{e.summary}</td>
                              <td className="px-4 py-3 text-xs text-white/55">
                                {e.actorName || e.actorEmail ? (
                                  <span>
                                    <span className="text-white/75">{e.actorName ?? "—"}</span>
                                    {e.actorEmail ? (
                                      <span className="mt-0.5 block text-[10px] text-white/40">{e.actorEmail}</span>
                                    ) : null}
                                  </span>
                                ) : (
                                  <span className="text-white/35">Système / inconnu</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                  </>
                ) : (
                  <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-white/45">
                    Votre rôle ne permet pas de consulter le journal d’audit détaillé.
                  </p>
                )}
              </motion.div>
            )}

            {tab === "security" && (
              <motion.div
                key="security"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="space-y-8"
              >
                <div>
                  <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Compte & sécurité</h2>
                  <p className="mt-1 text-xs text-white/40">
                    Dernière connexion, sessions actives sur d’autres appareils et double authentification (2FA).
                  </p>
                </div>

                <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
                  <h3 className="text-sm font-semibold text-brand-cream/90">Connexion</h3>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                        Dernière connexion réussie
                      </dt>
                      <dd className="mt-0.5 text-white/75">
                        {user?.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleString("fr-FR", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "— (première connexion ou non enregistrée)"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/35">2FA (TOTP)</dt>
                      <dd className="mt-0.5 text-white/75">{user?.totpEnabled ? "Activée" : "Désactivée"}</dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-brand-cream/90">Sessions actives</h3>
                      <p className="mt-1 text-xs text-white/40">
                        Navigateurs ou appareils où vous êtes encore connecté. Révoquez une session pour forcer la
                        déconnexion.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={securitySessionsLoading || (securitySessions?.length ?? 0) < 2}
                      onClick={async () => {
                        const r = await apiRevokeOtherAuthSessions();
                        if (!r.ok) return;
                        const list = await apiListAuthSessions();
                        setSecuritySessions(list);
                      }}
                      className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-medium text-brand-cream/90 transition-colors hover:border-brand-orange/35 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Révoquer les autres sessions
                    </button>
                  </div>
                  <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                        <tr>
                          <th className="px-3 py-2">Activité</th>
                          <th className="px-3 py-2">IP</th>
                          <th className="px-3 py-2">Navigateur</th>
                          <th className="px-3 py-2">Expire</th>
                          <th className="px-3 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {securitySessionsLoading && !securitySessions ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-white/40">
                              Chargement…
                            </td>
                          </tr>
                        ) : !securitySessions || securitySessions.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-white/40">
                              Aucune session (ou impossible de charger la liste).
                            </td>
                          </tr>
                        ) : (
                          securitySessions.map((s) => (
                            <tr key={s.id} className="border-b border-white/5">
                              <td className="px-3 py-2 text-xs text-white/65">
                                <span className="block">
                                  {new Date(s.lastSeenAt).toLocaleString("fr-FR", {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  })}
                                </span>
                                {s.isCurrent ? (
                                  <span className="mt-1 inline-block rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200/90">
                                    Session actuelle
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-white/50">{s.ip || "—"}</td>
                              <td className="max-w-[220px] truncate px-3 py-2 text-xs text-white/45" title={s.userAgent}>
                                {s.userAgent || "—"}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-white/50">
                                {new Date(s.expiresAt).toLocaleString("fr-FR", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const r = await apiRevokeAuthSession(s.id);
                                    if (!r.ok) return;
                                    if (s.isCurrent) {
                                      logout();
                                      return;
                                    }
                                    const list = await apiListAuthSessions();
                                    setSecuritySessions(list);
                                  }}
                                  className="rounded-lg border border-brand-red/30 px-2 py-1 text-[11px] text-brand-red/90 hover:bg-brand-red/10"
                                >
                                  Révoquer
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
                  <h3 className="text-sm font-semibold text-brand-cream/90">Double authentification (2FA)</h3>
                  <p className="mt-1 text-xs text-white/40">
                    Compatible avec Google Authenticator, Microsoft Authenticator, etc. (code TOTP à 6 chiffres).
                  </p>

                  {!user?.totpEnabled ? (
                    <div className="mt-4 space-y-4">
                      {!twofaSetup ? (
                        <button
                          type="button"
                          disabled={twofaBusy}
                          onClick={async () => {
                            setTwofaErr(null);
                            setTwofaBusy(true);
                            try {
                              const r = await apiStart2faSetup();
                              if (!r.ok) {
                                setTwofaErr(
                                  r.code === "2fa_already_enabled"
                                    ? "Le 2FA est déjà activé."
                                    : "Impossible de démarrer la configuration.",
                                );
                                return;
                              }
                              setTwofaSetup({ secret: r.secret, otpauthUrl: r.otpauthUrl });
                              setTwofaVerifyCode("");
                            } finally {
                              setTwofaBusy(false);
                            }
                          }}
                          className="rounded-xl border border-brand-orange/35 bg-brand-orange/10 px-4 py-2 text-sm font-medium text-brand-cream/95 hover:bg-brand-orange/20 disabled:opacity-50"
                        >
                          Configurer le 2FA
                        </button>
                      ) : (
                        <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
                          <p className="text-xs text-white/55">
                            Scannez le QR code ou saisissez la clé secrète dans votre application, puis entrez un code
                            pour confirmer.
                          </p>
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(twofaSetup.otpauthUrl)}`}
                              alt=""
                              width={160}
                              height={160}
                              className="shrink-0 rounded-lg border border-white/10 bg-white p-1"
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                                Clé secrète (saisie manuelle)
                              </p>
                              <code className="block break-all rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-brand-cream/85">
                                {twofaSetup.secret}
                              </code>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={twofaBusy}
                                  onClick={async () => {
                                    setTwofaErr(null);
                                    setTwofaBusy(true);
                                    try {
                                      const r = await apiVerify2faSetup(twofaVerifyCode);
                                      if (!r.ok) {
                                        setTwofaErr(
                                          r.code === "invalid_totp"
                                            ? "Code incorrect. Vérifiez l’heure de l’appareil et réessayez."
                                            : "Vérification impossible.",
                                        );
                                        return;
                                      }
                                      setTwofaSetup(null);
                                      setTwofaVerifyCode("");
                                      await refreshUser();
                                    } finally {
                                      setTwofaBusy(false);
                                    }
                                  }}
                                  className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-100/90 hover:bg-emerald-500/20 disabled:opacity-50"
                                >
                                  Activer après vérification
                                </button>
                                <button
                                  type="button"
                                  disabled={twofaBusy}
                                  onClick={async () => {
                                    await apiCancel2faSetup();
                                    setTwofaSetup(null);
                                    setTwofaVerifyCode("");
                                    setTwofaErr(null);
                                  }}
                                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5"
                                >
                                  Annuler
                                </button>
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase text-white/35">
                                  Code à 6 chiffres
                                </label>
                                <input
                                  value={twofaVerifyCode}
                                  onChange={(e) => setTwofaVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                                  className="w-40 rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                                  placeholder="000000"
                                  autoComplete="one-time-code"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {twofaErr ? (
                        <p className="text-sm text-red-200/90">{twofaErr}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs text-white/55">
                        Pour désactiver le 2FA, confirmez votre mot de passe et un code TOTP actuel.
                      </p>
                      <div className="grid gap-3 sm:max-w-md">
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase text-white/35">
                            Mot de passe
                          </label>
                          <input
                            type="password"
                            value={disable2faPassword}
                            onChange={(e) => setDisable2faPassword(e.target.value)}
                            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                            autoComplete="current-password"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase text-white/35">
                            Code 2FA
                          </label>
                          <input
                            value={disable2faTotp}
                            onChange={(e) => setDisable2faTotp(e.target.value.replace(/\D/g, "").slice(0, 8))}
                            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                            autoComplete="one-time-code"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={disable2faBusy}
                          onClick={async () => {
                            setDisable2faErr(null);
                            setDisable2faBusy(true);
                            try {
                              const r = await apiDisable2fa(disable2faPassword, disable2faTotp);
                              if (!r.ok) {
                                setDisable2faErr(
                                  r.code === "invalid_credentials"
                                    ? "Mot de passe incorrect."
                                    : r.code === "invalid_totp"
                                      ? "Code 2FA incorrect."
                                      : "Impossible de désactiver le 2FA.",
                                );
                                return;
                              }
                              setDisable2faPassword("");
                              setDisable2faTotp("");
                              await refreshUser();
                            } finally {
                              setDisable2faBusy(false);
                            }
                          }}
                          className="rounded-lg border border-brand-red/35 bg-brand-red/10 px-4 py-2 text-sm font-medium text-brand-cream/90 hover:bg-brand-red/20 disabled:opacity-50"
                        >
                          Désactiver le 2FA
                        </button>
                      </div>
                      {disable2faErr ? <p className="text-sm text-red-200/90">{disable2faErr}</p> : null}
                    </div>
                  )}
                </section>
              </motion.div>
            )}

            {tab === "appearance" && (
              <motion.div
                key="appearance"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-4">
                  <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Thème d’affichage</h2>
                  <p className="mt-1 text-xs text-white/40">
                    Choix enregistré sur cet appareil (navigateur). La page de connexion utilise le même réglage.
                  </p>
                </div>
                <p className="mb-4 text-xs text-white/50">
                  Actuellement affiché&nbsp;:{" "}
                  <span className="font-medium text-brand-cream/90">{resolvedDark ? "sombre" : "clair"}</span>
                  {preference === "system" ? " (selon le système)" : null}
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {themeChoices.map((c) => {
                    const Icon = c.icon;
                    const selected = preference === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setPreference(c.id)}
                        className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors ${
                          selected
                            ? "border-brand-orange/50 bg-brand-red/15 shadow-glow-sm dark:bg-brand-red/20"
                            : "border-white/10 bg-white/[0.03] hover:border-brand-orange/25 hover:bg-white/[0.06] dark:border-white/10"
                        }`}
                      >
                        <span className="flex w-full items-center gap-2">
                          <Icon className="h-5 w-5 shrink-0 text-brand-orange" aria-hidden />
                          <span className="font-display text-base tracking-wide text-white">{c.label}</span>
                        </span>
                        <span className="text-xs leading-relaxed text-white/45">{c.description}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
