import { useAuth } from "@/auth/AuthContext";
import { HEBERGEMENT_ROUTE_PERMS } from "@/lib/hebergementPermissions";
import { userCanSeeMainNavPath, userCanSeeMainNavTo } from "@/lib/navRoutePermissions";
import {
  logistiqueSectionLabel,
  logistiqueSectionPath,
  visibleInventorySections,
  visiblePurchasingSections,
} from "@/lib/logistiqueNavBuckets";
import { logistiqueSectionLucideIcon } from "@/lib/logistiqueSectionIcons";
import { userCanSeeFinanceHub } from "@/lib/financeModule";
import { userHasAnyPermission, userHasPermission } from "@/lib/permissions";
import { AnimatePresence, motion } from "framer-motion";
import {
  Banknote,
  BookText,
  Building2,
  CalendarRange,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  LineChart,
  Landmark,
  Moon,
  Search,
  ScrollText,
  Settings2,
  ShoppingBag,
  Sparkles,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

type CmdAction = {
  id: string;
  /** Regroupement affiché dans la liste (vide = navigation générale). */
  group: "" | "Hébergement" | "Finance" | "Logistique";
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
};

const actions: readonly CmdAction[] = [
  { id: "dash", group: "", label: "Aller au tableau de bord", to: "/", icon: LayoutDashboard },
  {
    id: "finhub",
    group: "Finance",
    label: "Module Finance — vue d’ensemble",
    to: "/finance",
    icon: Banknote,
  },
  { id: "pay", group: "Finance", label: "Paiement & encaissements (réservations)", to: "/paiement", icon: Wallet },
  { id: "inv", group: "Finance", label: "Facturation", to: "/facturation", icon: CreditCard },
  { id: "comptoir", group: "Finance", label: "Vente comptoir (buvette)", to: "/comptoir", icon: ShoppingBag },
  {
    id: "treso",
    group: "Finance",
    label: "Trésorerie — rapports de caisse",
    to: "/tresorerie",
    icon: Landmark,
  },
  {
    id: "cashbook",
    group: "Finance",
    label: "Livre de caisse — dépenses & banque",
    to: "/livre-caisse",
    icon: BookText,
  },
  { id: "rep", group: "Finance", label: "Rapports et pilotage (KPI)", to: "/rapports", icon: LineChart },
  {
    id: "rep-heb",
    group: "Hébergement",
    label: "Rapports et pilotage (KPI)",
    to: "/rapports",
    icon: LineChart,
  },
  { id: "audit", group: "Finance", label: "Clôture de journée & night audit", to: "/cloture-audit", icon: Moon },
  { id: "bung", group: "Hébergement", label: "Bungalows", to: "/bungalows", icon: Building2 },
  { id: "hk", group: "Hébergement", label: "Ménage & état des chambres", to: "/menage", icon: Sparkles },
  { id: "maint", group: "Hébergement", label: "Maintenance technique (tickets)", to: "/maintenance", icon: Wrench },
  { id: "res", group: "Hébergement", label: "Réservations & calendrier", to: "/reservations", icon: CalendarRange },
  {
    id: "caisse-rec",
    group: "Hébergement",
    label: "Caisse réception (séjours & visiteurs)",
    to: "/caisse-reception",
    icon: Wallet,
  },
  {
    id: "accueil",
    group: "Hébergement",
    label: "Accueil séjour (check-in / check-out)",
    to: "/accueil-sejour",
    icon: ClipboardCheck,
  },
  { id: "cli", group: "", label: "Clients", to: "/clients", icon: Users },
  { id: "set", group: "", label: "Paramètres", to: "/parametres", icon: Settings2 },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const logistiquePaletteActions = useMemo((): CmdAction[] => {
    if (!user || !userCanSeeMainNavPath(user, "/stocks")) return [];
    const out: CmdAction[] = [];
    for (const s of visibleInventorySections(user)) {
      out.push({
        id: `log-${s}`,
        group: "Logistique",
        label: logistiqueSectionLabel(s),
        to: logistiqueSectionPath(s),
        icon: logistiqueSectionLucideIcon(s),
      });
    }
    for (const s of visiblePurchasingSections(user)) {
      out.push({
        id: `log-${s}`,
        group: "Logistique",
        label: logistiqueSectionLabel(s),
        to: logistiqueSectionPath(s),
        icon: logistiqueSectionLucideIcon(s),
      });
    }
    return out;
  }, [user]);

  const allActions = useMemo(() => {
    const list = actions.filter((a) => {
      if (a.id === "rep-heb") {
        return (
          userCanSeeMainNavTo(user, a.to) && !userCanSeeFinanceHub(user)
        );
      }
      if (a.id === "rep") {
        return userCanSeeMainNavTo(user, a.to) && !!userCanSeeFinanceHub(user);
      }
      if (a.group === "Hébergement") {
        return userHasAnyPermission(user, [...(HEBERGEMENT_ROUTE_PERMS[a.to] ?? [])]);
      }
      if (a.group === "Finance") {
        if (!user?.isAppAdmin && !userCanSeeFinanceHub(user)) return false;
        return userCanSeeMainNavTo(user, a.to);
      }
      return userCanSeeMainNavTo(user, a.to);
    });
    const withLog = [...list];
    if (logistiquePaletteActions.length > 0) {
      const ixCli = withLog.findIndex((a) => a.id === "cli");
      if (ixCli >= 0) withLog.splice(ixCli, 0, ...logistiquePaletteActions);
      else withLog.push(...logistiquePaletteActions);
    }
    const withAudit = [...withLog];
    if (user?.isAppAdmin && (userHasPermission(user, "admin.audit") || userHasPermission(user, "admin.sessions"))) {
      const ix = withAudit.findIndex((a) => a.id === "set");
      withAudit.splice(Math.max(0, ix), 0, {
        id: "auditlog",
        group: "",
        label: "Journal d'audit (traçabilité)",
        to: "/parametres?onglet=journal-audit",
        icon: ScrollText,
      });
    }
    return withAudit;
  }, [user, logistiquePaletteActions]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [...allActions];
    return allActions.filter((a) => {
      const hay = `${a.label} ${a.group}`.toLowerCase();
      return hay.includes(s);
    });
  }, [q, allActions]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cmd-title"
        >
          <button type="button" className="absolute inset-0 bg-stone-900/45 backdrop-blur-sm dark:bg-black/70" onClick={onClose} aria-label="Fermer" />
          <motion.div
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-stone-200/80 bg-white/95 shadow-2xl shadow-stone-900/10 backdrop-blur-2xl dark:border-white/15 dark:bg-zinc-950/90 dark:shadow-brand-red/20"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            <h2 id="cmd-title" className="sr-only">
              Recherche rapide
            </h2>
            <div className="flex items-center gap-3 border-b border-stone-200/80 px-4 py-3 dark:border-white/10">
              <Search className="h-5 w-5 shrink-0 text-brand-orange" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher une section…"
                className="w-full bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400 dark:text-white dark:placeholder:text-white/35"
              />
              <kbd className="hidden rounded border border-stone-200/80 bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 sm:inline dark:border-white/15 dark:bg-white/5 dark:text-white/45">
                Esc
              </kbd>
            </div>
            <ul className="max-h-[min(50vh,320px)] overflow-auto p-2">
              {filtered.map((a, idx) => {
                const Icon = a.icon;
                const showGroupHeader =
                  a.group !== "" && (idx === 0 || filtered[idx - 1]?.group !== a.group);
                return (
                  <li key={a.id}>
                    {showGroupHeader ? (
                      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-white/35">
                        {a.group}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        navigate(a.to);
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-stone-800 transition-colors hover:bg-stone-100 dark:text-white/90 dark:hover:bg-white/10"
                    >
                      <Icon className="h-4 w-4 text-brand-cream/80" />
                      {a.label}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-stone-500 dark:text-white/40">Aucun résultat</li>
              )}
            </ul>
            <p className="border-t border-stone-200/80 px-4 py-2 text-[11px] text-stone-500 dark:border-white/10 dark:text-white/35">
              Astuce :{" "}
              <kbd className="rounded bg-stone-100 px-1 dark:bg-white/5">Ctrl</kbd> +{" "}
              <kbd className="rounded bg-stone-100 px-1 dark:bg-white/5">K</kbd> pour ouvrir / fermer
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
