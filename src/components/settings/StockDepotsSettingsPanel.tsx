import { apiGetStockDepots, apiPatchStockDepot, apiPostStockDepot } from "@/lib/api";
import type { StockDepotSetting } from "@/types";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export function StockDepotsSettingsPanel({
  readOnly,
  baseId,
}: {
  readOnly: boolean;
  baseId: string;
}) {
  const [rows, setRows] = useState<StockDepotSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  const [newLabel, setNewLabel] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadErr(false);
    const data = await apiGetStockDepots();
    setLoading(false);
    if (!data?.depots) {
      setLoadErr(true);
      setRows([]);
      return;
    }
    setRows(data.depots);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const updateRowField = useCallback(
    (id: string, patch: Partial<Pick<StockDepotSetting, "label" | "active">>) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [],
  );

  const saveRow = async (r: StockDepotSetting) => {
    if (readOnly) return;
    setSaveErr(null);
    setRowBusy(r.id);
    const res = await apiPatchStockDepot(r.id, {
      label: r.label.trim(),
      active: r.active,
    });
    setRowBusy(null);
    if (!res.ok) {
      setSaveErr(
        res.code === "last_depot_active"
          ? "Impossible de désactiver le dernier dépôt actif."
          : "Enregistrement impossible.",
      );
      await reload();
      return;
    }
    setRows((prev) => prev.map((x) => (x.id === res.depot.id ? res.depot : x)).sort(sortDepots));
  };

  const createDepot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    setSaveErr(null);
    const label = newLabel.trim();
    if (!label) {
      setSaveErr("Le libellé est obligatoire.");
      return;
    }
    setCreateBusy(true);
    const res = await apiPostStockDepot({ label });
    setCreateBusy(false);
    if (!res.ok) {
      setSaveErr(res.code === "validation_error" ? "Libellé invalide." : "Création impossible.");
      return;
    }
    setNewLabel("");
    setRows((prev) => [...prev, res.depot].sort(sortDepots));
  };

  return (
    <motion.div
      key="stock-depots-settings"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mb-4">
        <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Dépôts de stockage</h2>
        <p className="mt-1 text-xs text-white/40">
          Lieux de type <strong className="text-white/55">dépôt</strong> : réceptions fournisseur, stocks centralisés.
          Le <strong className="text-white/55">code technique</strong> est généré automatiquement à partir du libellé
          (suffixe <span className="font-mono text-white/45">_2</span>, <span className="font-mono text-white/45">_3</span>…
          si besoin). Les terrasses et points de vente se gèrent depuis la caisse / trésorerie. Au moins un dépôt actif
          doit rester disponible.
        </p>
        {loadErr ? (
          <p className="mt-2 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
            Impossible de charger les dépôts (session ou droits Paramètres).
          </p>
        ) : null}
        {loading ? <p className="mt-2 text-xs text-white/45">Chargement…</p> : null}
        {readOnly ? (
          <p className="mt-2 text-[11px] text-white/35">Lecture seule — réservé aux comptes avec édition des paramètres.</p>
        ) : null}
      </div>

      {saveErr ? (
        <p className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90" role="alert">
          {saveErr}
        </p>
      ) : null}

      {!readOnly ? (
        <form
          onSubmit={(ev) => void createDepot(ev)}
          className="mb-6 rounded-xl border border-white/10 bg-black/20 p-4"
        >
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/40">Nouveau dépôt</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-[220px] flex-1">
              <label htmlFor={`${baseId}-depot-label`} className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Libellé
              </label>
              <input
                id={`${baseId}-depot-label`}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="ex. Entrepôt nord"
                disabled={loading}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={loading || createBusy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-orange/35 bg-brand-orange/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-brand-cream transition-colors hover:bg-brand-orange/20 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {createBusy ? "…" : "Créer le dépôt"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Libellé</th>
              <th className="px-4 py-3 text-center">Actif</th>
              {!readOnly ? <th className="px-4 py-3 text-right"> </th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={readOnly ? 3 : 4} className="px-4 py-10 text-center text-white/45">
                  Aucun dépôt. Créez-en un ci-dessus.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-white/5">
                  <td className="px-4 py-2 align-middle">
                    <span className="font-mono text-xs text-brand-cream/85">{r.code}</span>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <label className="sr-only" htmlFor={`${baseId}-row-label-${r.id}`}>
                      Libellé {r.code}
                    </label>
                    <input
                      id={`${baseId}-row-label-${r.id}`}
                      value={r.label}
                      readOnly={readOnly}
                      onChange={(e) => updateRowField(r.id, { label: e.target.value })}
                      className="w-full min-w-[160px] rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-sm text-white outline-none read-only:cursor-not-allowed read-only:opacity-60 focus:ring-1 focus:ring-brand-orange/40"
                    />
                  </td>
                  <td className="px-4 py-2 text-center align-top">
                    <input
                      type="checkbox"
                      checked={r.active}
                      disabled={readOnly}
                      onChange={(e) => updateRowField(r.id, { active: e.target.checked })}
                      className="h-4 w-4 accent-brand-orange disabled:opacity-50"
                      aria-label={`Actif ${r.code}`}
                    />
                  </td>
                  {!readOnly ? (
                    <td className="px-4 py-2 text-right align-top">
                      <button
                        type="button"
                        disabled={rowBusy === r.id || loading}
                        onClick={() => void saveRow(r)}
                        className="rounded-lg bg-gradient-to-r from-brand-red to-brand-red-orange px-3 py-1.5 text-xs font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:opacity-45"
                      >
                        {rowBusy === r.id ? "…" : "Enregistrer"}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

function sortDepots(a: StockDepotSetting, b: StockDepotSetting): number {
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, "fr", { sensitivity: "base" });
}
