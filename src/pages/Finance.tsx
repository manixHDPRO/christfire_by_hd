import { useAuth } from "@/auth/AuthContext";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  FINANCE_HUB_CARDS,
  userCanSeeFinanceHub,
  visibleFinanceHubCards,
} from "@/lib/financeModule";
import { userCanSeeMainNavPath } from "@/lib/navRoutePermissions";
import { motion } from "framer-motion";
import {
  Banknote,
  BookText,
  Building2,
  ClipboardList,
  Landmark,
  LineChart,
  Moon,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, Navigate } from "react-router-dom";

const BRANCH_LABEL: Record<NonNullable<(typeof FINANCE_HUB_CARDS)[number]["branch"]>, string> = {
  treasury: "Trésorerie",
  cashbook: "Caisse & banque",
  counter: "Points de vente",
  billing: "Facturation",
  lodging: "Hébergement",
  audit: "Contrôle",
  reports: "Pilotage",
};

function branchHue(branch: (typeof FINANCE_HUB_CARDS)[number]["branch"]): string {
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

function cardIcon(branch: (typeof FINANCE_HUB_CARDS)[number]["branch"]): LucideIcon {
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

export function Finance() {
  const { user } = useAuth();
  if (!userCanSeeFinanceHub(user)) {
    return <Navigate to="/" replace />;
  }

  const cards = visibleFinanceHubCards(user);
  const showClients = userCanSeeMainNavPath(user, "/clients");

  return (
    <div>
      <Breadcrumb items={[{ label: "Finance" }]} />
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-orange/30 bg-brand-orange/10 text-brand-cream">
            <Wallet className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-4xl tracking-wide text-white">Module Finance</h1>
            <p className="mt-1 max-w-3xl text-sm text-white/45">
              Vue unifiée des flux financiers : encaissements, facturation, ventes comptoir,{" "}
              <strong className="text-white/60">trésorerie et caisses</strong>, pilotage et clôture. La trésorerie est
              une branche dédiée au suivi des points de vente et aux rapports journaliers.
            </p>
          </div>
        </div>
      </header>

      <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/50">
        <p>
          <ClipboardList className="mr-2 inline h-4 w-4 text-brand-orange/80 align-text-bottom" aria-hidden />
          Accédez aux écrans selon vos droits. Les rôles sont configurables dans{" "}
          <strong className="text-white/65">Paramètres</strong> (matrice des permissions).
        </p>
        {showClients ? (
          <p className="mt-2 text-white/40">
            Le répertoire <Link to="/clients" className="text-brand-orange/90 hover:underline">Clients</Link> reste
            accessible depuis le menu principal pour lier les fiches aux encaissements.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card, i) => {
          const Icon = cardIcon(card.branch);
          const branch = card.branch ? BRANCH_LABEL[card.branch] : null;
          const isTreasury = card.branch === "treasury";
          const isCashBook = card.branch === "cashbook";
          return (
            <motion.div
              key={card.to}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Link
                to={card.to}
                className={[
                  "block h-full rounded-2xl border p-5 transition-colors glass-panel",
                  isTreasury
                    ? "border-amber-500/35 hover:border-amber-400/50"
                    : isCashBook
                      ? "border-teal-500/35 hover:border-teal-400/45"
                      : "border-white/10 hover:border-brand-orange/30",
                ].join(" ")}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${branchHue(card.branch)} to-transparent`}
                  >
                    <Icon className="h-5 w-5 text-brand-cream" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    {branch ? (
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">{branch}</p>
                    ) : null}
                    <h2 className="font-display text-lg tracking-wide text-brand-cream/95">{card.title}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-white/45">{card.description}</p>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {cards.length === 0 ? (
        <p className="mt-8 text-center text-sm text-white/45">
          Aucune branche finance n’est accessible avec votre profil. Contactez un administrateur.
        </p>
      ) : null}
    </div>
  );
}
