import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { apiListBungalows } from "@/lib/api";
import type { Bungalow, BungalowCategory } from "@/types";
import { motion } from "framer-motion";
import { Filter, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const cats: (BungalowCategory | "Tous")[] = ["Tous", "Premium", "Deluxe", "Standard"];

export function Bungalows() {
  const [rows, setRows] = useState<Bungalow[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const b = await apiListBungalows();
    if (b === null) {
      setApiError(true);
      setRows([]);
    } else {
      setApiError(false);
      setRows(b);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const [cat, setCat] = useState<(typeof cats)[number]>("Tous");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    return rows.filter((b) => {
      const okCat = cat === "Tous" || b.category === cat;
      const s = q.trim().toLowerCase();
      const okQ =
        !s ||
        b.code.toLowerCase().includes(s) ||
        b.label.toLowerCase().includes(s) ||
        b.description.toLowerCase().includes(s);
      return okCat && okQ;
    });
  }, [cat, q, rows]);

  return (
    <div>
      <Breadcrumb items={[{ label: "Bungalows" }]} />
      <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-white">Bungalows</h1>
          <p className="mt-2 text-sm text-white/45">Référentiel, filtres et fiches détaillées.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Recherche code, nom…"
              disabled={loading || apiError}
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-4 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/30 focus:border-brand-orange/35 focus:ring-2 sm:w-64 disabled:opacity-40"
            />
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-1">
            <Filter className="ml-2 h-4 w-4 text-white/35" />
            {cats.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                disabled={loading || apiError}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  cat === c ? "bg-brand-red/50 text-white" : "text-white/45 hover:text-white/75"
                } disabled:opacity-40`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </header>

      {apiError && (
        <p className="mb-6 rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-sm text-brand-cream/95" role="alert">
          Impossible de charger les bungalows (API ou session). Vérifiez que le serveur tourne et que vous êtes connecté.
        </p>
      )}

      {loading ? (
        <p className="py-16 text-center text-white/45">Chargement des bungalows…</p>
      ) : (
        <>
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((b, i) => (
              <motion.li
                key={b.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link
                  to={`/bungalows/${b.id}`}
                  className={`glass-panel group flex h-full flex-col overflow-hidden rounded-2xl transition-shadow hover:shadow-glow ${
                    b.category === "Premium"
                      ? "ring-1 ring-brand-red/25 hover:ring-brand-red/45"
                      : b.category === "Deluxe"
                        ? "ring-1 ring-brand-orange/20 hover:ring-brand-orange/40"
                        : "ring-1 ring-white/10 hover:ring-brand-cream/20"
                  }`}
                >
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <img
                      src={b.image}
                      alt=""
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                      <CategoryBadge category={b.category} />
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          b.status === "Disponible"
                            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                            : b.status === "Réservé"
                              ? "border-violet-400/35 bg-violet-500/15 text-violet-100"
                              : b.status === "Occupé"
                                ? "border-sky-400/35 bg-sky-500/15 text-sky-100"
                                : b.status === "Maintenance"
                                  ? "border-brand-orange/35 bg-brand-orange/10 text-brand-cream"
                                  : "border-white/20 bg-white/5 text-white/55"
                        }`}
                      >
                        {b.status}
                      </span>
                    </div>
                    <p className="absolute bottom-3 left-3 font-display text-2xl tracking-wide text-white">{b.code}</p>
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <h2 className="text-lg font-semibold text-white/95">{b.label}</h2>
                    <p className="mt-1 line-clamp-2 text-sm text-white/45">{b.description}</p>
                    <p className="mt-auto pt-4 text-xs text-white/35">
                      {b.rooms} pièce{b.rooms > 1 ? "s" : ""} · {b.capacity} pers. max
                    </p>
                  </div>
                </Link>
              </motion.li>
            ))}
          </ul>
          {list.length === 0 && (
            <p className="py-16 text-center text-white/40">Aucun bungalow ne correspond aux filtres.</p>
          )}
        </>
      )}
    </div>
  );
}
