import { useAuth } from "@/auth/AuthContext";
import {
  FINANCE_HUB_CARDS,
  pathnameUnderFinanceModule,
  userCanSeeFinanceHub,
} from "@/lib/financeModule";
import { HEBERGEMENT_ROUTE_PERMS } from "@/lib/hebergementPermissions";
import { userCanSeeMainNavPath } from "@/lib/navRoutePermissions";
import {
  logistiqueSectionLabel,
  logistiqueSectionPath,
  visibleInventorySections,
  visiblePurchasingSections,
} from "@/lib/logistiqueNavBuckets";
import { logistiqueSectionLucideIcon } from "@/lib/logistiqueSectionIcons";
import { userHasAnyPermission } from "@/lib/permissions";
import {
  settingsFlyoutGroupActive,
  visibleSettingsFlyoutLinks,
} from "@/lib/settingsNav";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  Banknote,
  BookText,
  LineChart,
  Landmark,
  Building2,
  CalendarRange,
  ChevronDown,
  ClipboardCheck,
  Command,
  Hotel,
  LogOut,
  Moon,
  Settings2,
  ShoppingBag,
  Sparkles,
  Truck,
  Users,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";

type NavLinkItem = { kind: "link"; to: string; label: string; icon: LucideIcon; hue: string };
type NavHeadingItem = {
  kind: "heading";
  label: string;
  variant?: "hebergement" | "finance" | "logistique";
};

type OrbitLink = { to: string; label: string; icon: LucideIcon; hue: string };

type NavFlyoutId = "finance" | "hebergement" | "logistique" | "parametres";

function isSettingsFlyoutLinkActive(loc: { pathname: string; search: string }, to: string): boolean {
  if (loc.pathname !== "/parametres") return false;
  const qStr = to.includes("?") ? to.slice(to.indexOf("?")) : "";
  const want = new URLSearchParams(qStr).get("onglet");
  const have = new URLSearchParams(loc.search).get("onglet");
  return want != null && want === have;
}

const hebergementLinks = [
  { to: "/bungalows", label: "Bungalows", icon: Building2, hue: "from-brand-orange/25" },
  { to: "/menage", label: "Ménage", icon: Sparkles, hue: "from-brand-cream/18" },
  { to: "/maintenance", label: "Maintenance", icon: Wrench, hue: "from-amber-500/20" },
  { to: "/reservations", label: "Réservations", icon: CalendarRange, hue: "from-brand-red-orange/25" },
  {
    to: "/caisse-reception",
    label: "Caisse réception",
    icon: Banknote,
    hue: "from-violet-500/22",
  },
  {
    to: "/accueil-sejour",
    label: "Accueil séjour",
    icon: ClipboardCheck,
    hue: "from-emerald-500/20",
  },
] as const satisfies readonly OrbitLink[];

function pathMatchesHebergement(pathname: string, links: readonly OrbitLink[]): boolean {
  return links.some((l) => pathname === l.to || pathname.startsWith(`${l.to}/`));
}

function financeBranchHue(branch: (typeof FINANCE_HUB_CARDS)[number]["branch"]): string {
  switch (branch) {
    case "treasury":
      return "from-amber-400/25";
    case "cashbook":
      return "from-teal-500/22";
    case "counter":
      return "from-brand-cream/20";
    case "billing":
      return "from-brand-orange/22";
    case "lodging":
      return "from-emerald-500/18";
    case "audit":
      return "from-indigo-500/22";
    case "reports":
      return "from-rose-500/20";
    default:
      return "from-white/10";
  }
}

function financeBranchIcon(branch: (typeof FINANCE_HUB_CARDS)[number]["branch"]): LucideIcon {
  switch (branch) {
    case "treasury":
      return Landmark;
    case "cashbook":
      return BookText;
    case "counter":
      return ShoppingBag;
    case "billing":
      return Banknote;
    case "lodging":
      return Building2;
    case "audit":
      return Moon;
    case "reports":
      return LineChart;
    default:
      return Wallet;
  }
}

export function OrbitalSidebar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const { user, logout } = useAuth();
  const [orbitOpen, setOrbitOpen] = useState(false);
  /** Panneau latéral (icône + libellés) pour Finance / Hébergement — évite la pile coupée en bas du rail. */
  const [navFlyout, setNavFlyout] = useState<NavFlyoutId | null>(null);
  const reduceMotion = useReducedMotion();
  const location = useLocation();

  const visibleHebergementLinks = useMemo((): OrbitLink[] => {
    if (!user) return [];
    const base = hebergementLinks.filter((l) =>
      userHasAnyPermission(user, [...(HEBERGEMENT_ROUTE_PERMS[l.to] ?? [])]),
    );
    /** Accès KPI via réservations seules : pas de menu Finance, lien regroupé ici. */
    const showRapportsHere =
      userCanSeeMainNavPath(user, "/rapports") && !userCanSeeFinanceHub(user);
    if (!showRapportsHere) return [...base];
    return [
      ...base,
      {
        to: "/rapports",
        label: "Rapports & pilotage",
        icon: LineChart,
        hue: "from-rose-500/20",
      },
    ];
  }, [user]);

  const visibleFinanceNav = useMemo((): OrbitLink[] => {
    if (!user) return [];
    /** Aucune entrée Finance tant qu’aucun droit « module Finance » (hors seul droit réservations). */
    if (!user.isAppAdmin && !userCanSeeFinanceHub(user)) {
      return [];
    }
    const links: OrbitLink[] = [
      {
        to: "/finance",
        label: "Module Finance",
        icon: Banknote,
        hue: "from-amber-500/22",
      },
    ];
    for (const c of FINANCE_HUB_CARDS) {
      if (user.isAppAdmin || userHasAnyPermission(user, c.anyOf)) {
        links.push({
          to: c.to,
          label: c.title,
          icon: financeBranchIcon(c.branch),
          hue: financeBranchHue(c.branch),
        });
      }
    }
    return links;
  }, [user]);

  const visibleLogistiqueNav = useMemo((): OrbitLink[] => {
    if (!user) return [];
    if (!userCanSeeMainNavPath(user, "/stocks")) return [];
    const invHue = "from-emerald-500/18";
    const purHue = "from-teal-500/22";
    const links: OrbitLink[] = [];
    for (const s of visibleInventorySections(user)) {
      links.push({
        to: logistiqueSectionPath(s),
        label: logistiqueSectionLabel(s),
        icon: logistiqueSectionLucideIcon(s),
        hue: invHue,
      });
    }
    for (const s of visiblePurchasingSections(user)) {
      links.push({
        to: logistiqueSectionPath(s),
        label: logistiqueSectionLabel(s),
        icon: logistiqueSectionLucideIcon(s),
        hue: purHue,
      });
    }
    return links;
  }, [user]);

  const tailNavOrbit = useMemo((): OrbitLink[] => {
    const tail: OrbitLink[] = [{ to: "/clients", label: "Clients", icon: Users, hue: "from-brand-cream/15" }];
    return tail.filter((l) => userCanSeeMainNavPath(user, l.to));
  }, [user]);

  const settingsFlyoutLinks = useMemo(() => visibleSettingsFlyoutLinks(user), [user]);

  const showSettingsRail = Boolean(user && userCanSeeMainNavPath(user, "/parametres"));

  const settingsActive = useMemo(
    () => settingsFlyoutGroupActive(location.pathname),
    [location.pathname],
  );

  const orbitEntries = useMemo(() => {
    const dash: OrbitLink = {
      to: "/",
      label: "Tableau de bord",
      icon: BarChart3,
      hue: "from-brand-red/30",
    };
    const showParametresInOrbit = Boolean(user && userCanSeeMainNavPath(user, "/parametres"));
    const entries: (NavLinkItem | NavHeadingItem)[] = [
      { kind: "link", ...dash },
      ...(visibleFinanceNav.length
        ? ([{ kind: "heading" as const, label: "Finance", variant: "finance" as const }] as const)
        : []),
      ...visibleFinanceNav.map((l) => ({ kind: "link" as const, ...l })),
      ...(visibleHebergementLinks.length
        ? ([{ kind: "heading" as const, label: "Hébergement", variant: "hebergement" as const }] as const)
        : []),
      ...visibleHebergementLinks.map((l) => ({ kind: "link" as const, ...l })),
      ...(visibleLogistiqueNav.length
        ? ([{ kind: "heading" as const, label: "Logistique", variant: "logistique" as const }] as const)
        : []),
      ...visibleLogistiqueNav.map((l) => ({ kind: "link" as const, ...l })),
      ...tailNavOrbit.map((l) => ({ kind: "link" as const, ...l })),
      ...(showParametresInOrbit
        ? ([
            {
              kind: "link" as const,
              to: "/parametres",
              label: "Paramètres",
              icon: Settings2,
              hue: "from-white/10",
            },
          ] as const)
        : []),
    ];
    return entries;
  }, [user, visibleFinanceNav, visibleHebergementLinks, visibleLogistiqueNav, tailNavOrbit]);

  /** Déduplique les liens par `to` (évite clés React en double). */
  const orbitEntriesForRender = useMemo(() => {
    const seen = new Set<string>();
    const out: (NavLinkItem | NavHeadingItem)[] = [];
    for (const e of orbitEntries) {
      if (e.kind !== "link") {
        out.push(e);
        continue;
      }
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      out.push(e);
    }
    return out;
  }, [orbitEntries]);

  const financeActive = useMemo(
    () => pathnameUnderFinanceModule(location.pathname),
    [location.pathname],
  );

  const hebergementActive = useMemo(
    () => pathMatchesHebergement(location.pathname, visibleHebergementLinks),
    [location.pathname, visibleHebergementLinks],
  );

  const logistiqueActive = useMemo(
    () => location.pathname.startsWith("/logistique/"),
    [location.pathname],
  );

  const flyoutPanel = useMemo(() => {
    switch (navFlyout) {
      case "finance":
        return { title: "Finance" as const, links: visibleFinanceNav };
      case "hebergement":
        return { title: "Hébergement" as const, links: visibleHebergementLinks as readonly OrbitLink[] };
      case "logistique":
        return { title: "Logistique" as const, links: visibleLogistiqueNav };
      case "parametres":
        return { title: "Paramètres" as const, links: settingsFlyoutLinks };
      default:
        return null;
    }
  }, [navFlyout, visibleFinanceNav, visibleHebergementLinks, visibleLogistiqueNav, settingsFlyoutLinks]);

  const closeOrbit = useCallback(() => setOrbitOpen(false), []);

  useEffect(() => {
    setNavFlyout(null);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeOrbit();
        setNavFlyout(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOrbit]);

  return (
    <>
      <aside
        className="fixed left-0 top-0 z-40 flex h-full w-[4.5rem] flex-col items-center border-r border-stone-200/80 bg-white/80 py-4 backdrop-blur-2xl dark:border-white/10 dark:bg-black/30 md:w-[5.25rem]"
        aria-label="Navigation principale"
      >
        <motion.button
          type="button"
          onClick={() => {
            setNavFlyout(null);
            setOrbitOpen((v) => !v);
          }}
          className="group relative mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-orange/40 bg-gradient-to-br from-brand-red to-brand-red-orange shadow-glow-sm outline-none ring-brand-orange/50 focus-visible:ring-2"
          whileHover={reduceMotion ? undefined : { scale: 1.05 }}
          whileTap={reduceMotion ? undefined : { scale: 0.97 }}
          aria-expanded={orbitOpen}
          aria-controls="orbital-menu"
          title="Menu navigation (toutes les destinations)"
        >
          <motion.span
            className="absolute inset-0 rounded-2xl bg-brand-orange/20 opacity-0 blur-md transition-opacity group-hover:opacity-100"
            animate={orbitOpen ? { opacity: 0.5 } : {}}
          />
          <img
            src="/favicon.svg"
            alt=""
            width={32}
            height={32}
            className="relative z-10 h-8 w-8 object-contain"
            aria-hidden
          />
        </motion.button>

        <nav
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto overscroll-y-contain"
          aria-label="Raccourcis"
        >
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              [
                "group relative flex h-12 w-12 items-center justify-center rounded-xl border border-transparent outline-none transition-colors md:h-[3.25rem] md:w-[3.25rem]",
                isActive
                  ? "border-brand-orange/35 bg-brand-red/10 text-brand-red dark:bg-white/10 dark:text-brand-cream shadow-glow-sm"
                  : "text-stone-600 hover:border-stone-200 hover:bg-stone-100 hover:text-stone-900 dark:text-white/55 dark:hover:border-white/10 dark:hover:bg-white/5 dark:hover:text-white",
              ].join(" ")
            }
          >
            <BarChart3 className="h-[1.35rem] w-[1.35rem] shrink-0" aria-hidden />
            <span className="sr-only">Tableau de bord</span>
            <span
              className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg border border-stone-200/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-stone-800 opacity-0 shadow-xl backdrop-blur-md transition-opacity group-hover:opacity-100 dark:border-white/10 dark:bg-black/70 dark:text-white/90 md:block"
              role="tooltip"
            >
              Tableau de bord
            </span>
          </NavLink>

          {visibleFinanceNav.length > 0 ? (
            <div className="flex flex-col gap-1">
              <motion.button
                type="button"
                onClick={() => {
                  setOrbitOpen(false);
                  setNavFlyout((n) => (n === "finance" ? null : "finance"));
                }}
                aria-expanded={navFlyout === "finance"}
                aria-controls={navFlyout === "finance" ? "nav-flyout" : undefined}
                className={[
                  "group relative flex h-12 w-12 items-center justify-center rounded-xl border border-transparent outline-none transition-colors md:h-[3.25rem] md:w-[3.25rem]",
                  financeActive && navFlyout !== "finance"
                    ? "border-brand-orange/25 bg-brand-orange/10 text-brand-red dark:text-brand-cream"
                    : "text-stone-600 hover:border-stone-200 hover:bg-stone-100 hover:text-stone-900 dark:text-white/55 dark:hover:border-white/10 dark:hover:bg-white/5 dark:hover:text-white",
                ].join(" ")}
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
              >
                <Banknote className="h-[1.35rem] w-[1.35rem] shrink-0" aria-hidden />
                <ChevronDown
                  className={`pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 text-stone-400 transition-transform dark:text-white/40 ${navFlyout === "finance" ? "rotate-180" : ""}`}
                  aria-hidden
                />
                <span className="sr-only">
                  Finance — {navFlyout === "finance" ? "fermer le panneau des liens" : "ouvrir le panneau des liens"}
                </span>
                <span
                  className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg border border-stone-200/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-stone-800 opacity-0 shadow-xl backdrop-blur-md transition-opacity group-hover:opacity-100 dark:border-white/10 dark:bg-black/70 dark:text-white/90 md:block"
                  role="tooltip"
                >
                  Finance
                </span>
              </motion.button>
            </div>
          ) : null}

          {visibleHebergementLinks.length > 0 ? (
            <div className="flex flex-col gap-1">
              <motion.button
                type="button"
                onClick={() => {
                  setOrbitOpen(false);
                  setNavFlyout((n) => (n === "hebergement" ? null : "hebergement"));
                }}
                aria-expanded={navFlyout === "hebergement"}
                aria-controls={navFlyout === "hebergement" ? "nav-flyout" : undefined}
                className={[
                  "group relative flex h-12 w-12 items-center justify-center rounded-xl border border-transparent outline-none transition-colors md:h-[3.25rem] md:w-[3.25rem]",
                  hebergementActive && navFlyout !== "hebergement"
                    ? "border-brand-orange/25 bg-brand-orange/10 text-brand-red dark:text-brand-cream"
                    : "text-stone-600 hover:border-stone-200 hover:bg-stone-100 hover:text-stone-900 dark:text-white/55 dark:hover:border-white/10 dark:hover:bg-white/5 dark:hover:text-white",
                ].join(" ")}
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
              >
                <Hotel className="h-[1.35rem] w-[1.35rem] shrink-0" aria-hidden />
                <ChevronDown
                  className={`pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 text-stone-400 transition-transform dark:text-white/40 ${navFlyout === "hebergement" ? "rotate-180" : ""}`}
                  aria-hidden
                />
                <span className="sr-only">
                  Hébergement —{" "}
                  {navFlyout === "hebergement" ? "fermer le panneau des liens" : "ouvrir le panneau des liens"}
                </span>
                <span
                  className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg border border-stone-200/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-stone-800 opacity-0 shadow-xl backdrop-blur-md transition-opacity group-hover:opacity-100 dark:border-white/10 dark:bg-black/70 dark:text-white/90 md:block"
                  role="tooltip"
                >
                  Hébergement
                </span>
              </motion.button>
            </div>
          ) : null}

          {visibleLogistiqueNav.length > 0 ? (
            <div className="flex flex-col gap-1">
              <motion.button
                type="button"
                onClick={() => {
                  setOrbitOpen(false);
                  setNavFlyout((n) => (n === "logistique" ? null : "logistique"));
                }}
                aria-expanded={navFlyout === "logistique"}
                aria-controls={navFlyout === "logistique" ? "nav-flyout" : undefined}
                className={[
                  "group relative flex h-12 w-12 items-center justify-center rounded-xl border border-transparent outline-none transition-colors md:h-[3.25rem] md:w-[3.25rem]",
                  logistiqueActive && navFlyout !== "logistique"
                    ? "border-brand-orange/25 bg-brand-orange/10 text-brand-red dark:text-brand-cream"
                    : "text-stone-600 hover:border-stone-200 hover:bg-stone-100 hover:text-stone-900 dark:text-white/55 dark:hover:border-white/10 dark:hover:bg-white/5 dark:hover:text-white",
                ].join(" ")}
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
              >
                <Truck className="h-[1.35rem] w-[1.35rem] shrink-0" aria-hidden />
                <ChevronDown
                  className={`pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 text-stone-400 transition-transform dark:text-white/40 ${navFlyout === "logistique" ? "rotate-180" : ""}`}
                  aria-hidden
                />
                <span className="sr-only">
                  Logistique —{" "}
                  {navFlyout === "logistique" ? "fermer le panneau des liens" : "ouvrir le panneau des liens"}
                </span>
                <span
                  className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg border border-stone-200/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-stone-800 opacity-0 shadow-xl backdrop-blur-md transition-opacity group-hover:opacity-100 dark:border-white/10 dark:bg-black/70 dark:text-white/90 md:block"
                  role="tooltip"
                >
                  Logistique
                </span>
              </motion.button>
            </div>
          ) : null}

          {tailNavOrbit.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                [
                  "group relative flex h-12 w-12 items-center justify-center rounded-xl border border-transparent outline-none transition-colors md:h-[3.25rem] md:w-[3.25rem]",
                  isActive
                    ? "border-brand-orange/35 bg-brand-red/10 text-brand-red dark:bg-white/10 dark:text-brand-cream shadow-glow-sm"
                    : "text-stone-600 hover:border-stone-200 hover:bg-stone-100 hover:text-stone-900 dark:text-white/55 dark:hover:border-white/10 dark:hover:bg-white/5 dark:hover:text-white",
                ].join(" ")
              }
            >
              <Icon className="h-[1.35rem] w-[1.35rem] shrink-0" aria-hidden />
              <span className="sr-only">{label}</span>
              <span
                className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg border border-stone-200/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-stone-800 opacity-0 shadow-xl backdrop-blur-md transition-opacity group-hover:opacity-100 dark:border-white/10 dark:bg-black/70 dark:text-white/90 md:block"
                role="tooltip"
              >
                {label}
              </span>
            </NavLink>
          ))}

          {showSettingsRail && settingsFlyoutLinks.length > 0 ? (
            <div className="flex flex-col gap-1">
              <motion.button
                type="button"
                onClick={() => {
                  setOrbitOpen(false);
                  setNavFlyout((n) => (n === "parametres" ? null : "parametres"));
                }}
                aria-expanded={navFlyout === "parametres"}
                aria-controls={navFlyout === "parametres" ? "nav-flyout" : undefined}
                className={[
                  "group relative flex h-12 w-12 items-center justify-center rounded-xl border border-transparent outline-none transition-colors md:h-[3.25rem] md:w-[3.25rem]",
                  settingsActive && navFlyout !== "parametres"
                    ? "border-brand-orange/25 bg-brand-orange/10 text-brand-red dark:text-brand-cream"
                    : "text-stone-600 hover:border-stone-200 hover:bg-stone-100 hover:text-stone-900 dark:text-white/55 dark:hover:border-white/10 dark:hover:bg-white/5 dark:hover:text-white",
                ].join(" ")}
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
              >
                <Settings2 className="h-[1.35rem] w-[1.35rem] shrink-0" aria-hidden />
                <ChevronDown
                  className={`pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 text-stone-400 transition-transform dark:text-white/40 ${navFlyout === "parametres" ? "rotate-180" : ""}`}
                  aria-hidden
                />
                <span className="sr-only">
                  Paramètres —{" "}
                  {navFlyout === "parametres" ? "fermer le panneau des liens" : "ouvrir le panneau des liens"}
                </span>
                <span
                  className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg border border-stone-200/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-stone-800 opacity-0 shadow-xl backdrop-blur-md transition-opacity group-hover:opacity-100 dark:border-white/10 dark:bg-black/70 dark:text-white/90 md:block"
                  role="tooltip"
                >
                  Paramètres
                </span>
              </motion.button>
            </div>
          ) : null}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-2">
          <div
            className="mb-1 hidden max-w-[4.5rem] truncate text-center text-[9px] font-medium uppercase leading-tight tracking-wide text-stone-500 dark:text-white/35 md:block"
            title={`${user?.name ?? ""} · ${user?.role ?? ""}`}
          >
            {user?.name?.split(" ")[0]}
          </div>
          <motion.button
            type="button"
            onClick={onOpenCommand}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-stone-200/80 text-stone-600 outline-none transition-colors hover:border-brand-orange/35 hover:bg-stone-100 hover:text-brand-red dark:border-white/10 dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-brand-cream focus-visible:ring-2 focus-visible:ring-brand-orange/50"
            whileHover={reduceMotion ? undefined : { y: -2 }}
            title="Palette de commandes (Ctrl+K)"
          >
            <Command className="h-5 w-5" />
            <span className="sr-only">Ouvrir la palette</span>
          </motion.button>
          <motion.button
            type="button"
            onClick={logout}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-stone-200/80 text-stone-500 outline-none transition-colors hover:border-red-400/40 hover:bg-red-50 hover:text-red-700 dark:border-white/10 dark:text-white/50 dark:hover:bg-red-500/10 dark:hover:text-red-200 focus-visible:ring-2 focus-visible:ring-red-400/40"
            whileHover={reduceMotion ? undefined : { y: -2 }}
            title="Déconnexion"
          >
            <LogOut className="h-5 w-5" />
            <span className="sr-only">Déconnexion</span>
          </motion.button>
        </div>
      </aside>

      {createPortal(
        <AnimatePresence>
          {flyoutPanel && navFlyout ? (
            <motion.div
              key={navFlyout}
              className="fixed inset-0 z-[90]"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.15 }}
            >
              <button
                type="button"
                className="absolute inset-0 bg-stone-900/35 dark:bg-black/50"
                aria-label="Fermer le panneau"
                onClick={() => setNavFlyout(null)}
              />
              <aside
                id="nav-flyout"
                role="dialog"
                aria-modal="true"
                aria-label={flyoutPanel.title}
                className="absolute left-[4.5rem] top-3 z-[1] flex max-h-[calc(100vh-1.5rem)] w-[min(20rem,calc(100vw-4.5rem-0.75rem))] flex-col overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-2xl dark:border-white/15 dark:bg-zinc-950 md:left-[5.25rem] md:w-[18rem]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-stone-200/80 px-3 py-2.5 dark:border-white/10">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-white/45">
                    {flyoutPanel.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => setNavFlyout(null)}
                    className="rounded-lg p-1.5 text-stone-500 outline-none transition-colors hover:bg-stone-100 hover:text-stone-800 focus-visible:ring-2 focus-visible:ring-brand-orange/50 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
                    aria-label="Fermer le panneau"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <nav
                  className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-y-contain px-2 py-2"
                  aria-label={flyoutPanel.title}
                >
                  {flyoutPanel.links.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={
                        (navFlyout === "finance" && to === "/finance") || navFlyout === "logistique"
                      }
                      onClick={() => setNavFlyout(null)}
                      className={({ isActive: navLinkActive }) => {
                        const isActive =
                          navFlyout === "parametres"
                            ? isSettingsFlyoutLinkActive(location, to)
                            : navLinkActive;
                        return [
                          "relative flex w-full shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-orange/50",
                          isActive
                            ? "bg-brand-red/12 font-medium text-brand-red dark:bg-white/10 dark:text-brand-cream"
                            : "text-stone-800 hover:bg-stone-100 dark:text-white/85 dark:hover:bg-white/10",
                        ].join(" ");
                      }}
                    >
                      <Icon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                      <span className="min-w-0 flex-1 leading-snug">{label}</span>
                    </NavLink>
                  ))}
                </nav>
              </aside>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}

      {createPortal(
        <AnimatePresence>
          {orbitOpen ? (
            <motion.div
              key="orbital-menu-root"
              id="orbital-menu"
              className="fixed inset-0 z-[100] bg-stone-900/45 dark:bg-black/55"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
              onClick={closeOrbit}
              role="dialog"
              aria-modal="true"
              aria-label="Menu navigation"
            >
              <div
                className="pointer-events-auto absolute bottom-0 left-[4.5rem] top-0 z-[101] flex w-[min(22rem,calc(100vw-4.75rem))] flex-col border-r border-stone-200/90 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-950 md:left-[5.25rem]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-stone-200/80 px-3 py-3 dark:border-white/10">
                  <span className="font-display text-xl tracking-wide text-brand-red dark:text-brand-cream">
                    Navigation
                  </span>
                  <button
                    type="button"
                    className="rounded-lg p-2 text-stone-600 outline-none hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-brand-orange dark:text-white/70 dark:hover:bg-white/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeOrbit();
                    }}
                    aria-label="Fermer le menu"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-y-contain px-2 py-2">
                  {orbitEntriesForRender.map((item, i) => {
                    if (item.kind === "heading") {
                      const HeadingIcon =
                        item.variant === "finance" ? Banknote : item.variant === "logistique" ? Truck : Hotel;
                      return (
                        <div
                          key={`h-${item.variant ?? "h"}-${item.label}-${i}`}
                          className={
                            i > 0
                              ? "mt-2 flex items-center gap-2 border-t border-stone-200/80 px-2 pt-3 dark:border-white/10"
                              : "flex items-center gap-2 px-2 pt-1"
                          }
                        >
                          <HeadingIcon className="h-4 w-4 shrink-0 text-brand-orange dark:text-brand-orange/90" aria-hidden />
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-white/45">
                            {item.label}
                          </span>
                        </div>
                      );
                    }

                    const Icon = item.icon;
                    const [itemPath, itemQuery] = item.to.split("?");
                    const isHere =
                      itemQuery != null
                        ? location.pathname === itemPath &&
                          new URLSearchParams(location.search).get("onglet") ===
                            new URLSearchParams(itemQuery).get("onglet")
                        : location.pathname === item.to ||
                          (item.to !== "/" && location.pathname.startsWith(item.to));

                    return (
                      <NavLink
                        key={`orbit-link-${i}-${item.to}`}
                        to={item.to}
                        end={item.to === "/" || item.to.startsWith("/logistique/")}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeOrbit();
                        }}
                        className={`relative flex w-full shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          isHere
                            ? "border-brand-orange/40 bg-brand-red/10 text-brand-red dark:border-brand-orange/35 dark:bg-white/10 dark:text-brand-cream"
                            : "border-transparent text-stone-800 hover:border-stone-200 hover:bg-stone-50 dark:text-white/88 dark:hover:border-white/10 dark:hover:bg-white/5"
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${item.hue} to-transparent`}
                        >
                          <Icon className="h-4 w-4 text-brand-cream" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 font-display text-base leading-snug tracking-wide">
                          {item.label}
                        </span>
                      </NavLink>
                    );
                  })}
                </nav>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
