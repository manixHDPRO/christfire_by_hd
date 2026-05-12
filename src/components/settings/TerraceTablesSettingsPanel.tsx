import {
  apiDeleteTerraceDiningTable,
  apiListTerraceDiningTables,
  apiListTerracePointsOfSale,
  apiPatchTerraceDiningTable,
  apiPostTerraceDiningTable,
} from "@/lib/api";
import type { DiningTerraceTableSetting, TerracePointOfSaleOption } from "@/types";
import { motion } from "framer-motion";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

function sortTerraces(a: TerracePointOfSaleOption, b: TerracePointOfSaleOption): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, "fr", { sensitivity: "base" });
}

function sortTables(a: DiningTerraceTableSetting, b: DiningTerraceTableSetting): number {
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, "fr", { sensitivity: "base" });
}

export function TerraceTablesSettingsPanel({
  readOnly,
  baseId,
}: {
  readOnly: boolean;
  baseId: string;
}) {
  const [terraces, setTerraces] = useState<TerracePointOfSaleOption[]>([]);
  const [selectedPosId, setSelectedPosId] = useState("");
  const [tables, setTables] = useState<DiningTerraceTableSetting[]>([]);
  const [loadingTerraces, setLoadingTerraces] = useState(true);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);

  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newSeats, setNewSeats] = useState("4");

  const reloadTerraces = useCallback(async () => {
    setLoadingTerraces(true);
    setLoadErr(false);
    const data = await apiListTerracePointsOfSale();
    setLoadingTerraces(false);
    if (!data?.terraces) {
      setLoadErr(true);
      setTerraces([]);
      return;
    }
    const list = [...data.terraces].sort(sortTerraces);
    setTerraces(list);
    setSelectedPosId((prev) => {
      if (prev && list.some((t) => t.id === prev)) return prev;
      const firstActive = list.find((t) => t.active);
      return firstActive?.id ?? list[0]?.id ?? "";
    });
  }, []);

  const reloadTables = useCallback(async (pointOfSaleId: string) => {
    if (!pointOfSaleId) {
      setTables([]);
      return;
    }
    setLoadingTables(true);
    const data = await apiListTerraceDiningTables(pointOfSaleId);
    setLoadingTables(false);
    if (!data?.tables) {
      setLoadErr(true);
      setTables([]);
      return;
    }
    setTables([...data.tables].sort(sortTables));
  }, []);

  useEffect(() => {
    void reloadTerraces();
  }, [reloadTerraces]);

  useEffect(() => {
    if (!selectedPosId) {
      setTables([]);
      return;
    }
    void reloadTables(selectedPosId);
  }, [selectedPosId, reloadTables]);

  const selectedTerraceLabel = useMemo(() => {
    const t = terraces.find((x) => x.id === selectedPosId);
    return t?.label ?? "";
  }, [terraces, selectedPosId]);

  const updateRowLocal = useCallback(
    (id: string, patch: Partial<Pick<DiningTerraceTableSetting, "code" | "label" | "seats" | "active">>) => {
      setTables((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [],
  );

  const saveRow = async (r: DiningTerraceTableSetting) => {
    if (readOnly) return;
    setSaveErr(null);
    setRowBusy(r.id);
    const seats = Number(r.seats);
    if (!Number.isFinite(seats) || seats < 1 || seats > 99) {
      setSaveErr("Nombre de couverts : entre 1 et 99.");
      setRowBusy(null);
      return;
    }
    const res = await apiPatchTerraceDiningTable(r.id, {
      code: r.code.trim(),
      label: r.label.trim(),
      seats: Math.floor(seats),
      active: r.active,
    });
    setRowBusy(null);
    if (!res.ok) {
      setSaveErr(
        res.code === "code_exists"
          ? "Ce code de table existe déjà sur cette terrasse."
          : res.code === "invalid_code"
            ? "Code invalide (lettres, chiffres, tirets ou soulignés, max 32)."
            : "Enregistrement impossible.",
      );
      await reloadTables(selectedPosId);
      return;
    }
    setTables((prev) => [...prev.map((x) => (x.id === res.table.id ? res.table : x))].sort(sortTables));
  };

  const deleteRow = async (id: string) => {
    if (readOnly) return;
    setSaveErr(null);
    setDeleteBusy(id);
    const res = await apiDeleteTerraceDiningTable(id);
    setDeleteBusy(null);
    if (!res.ok) {
      setSaveErr("Suppression impossible.");
      return;
    }
    setTables((prev) => prev.filter((x) => x.id !== id));
  };

  const createTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !selectedPosId) return;
    setSaveErr(null);
    const code = newCode.trim();
    const label = newLabel.trim();
    if (!code || !label) {
      setSaveErr("Code et libellé sont obligatoires.");
      return;
    }
    const seats = Number(newSeats);
    if (!Number.isFinite(seats) || seats < 1 || seats > 99) {
      setSaveErr("Nombre de couverts : entre 1 et 99.");
      return;
    }
    setCreateBusy(true);
    const res = await apiPostTerraceDiningTable({
      pointOfSaleId: selectedPosId,
      code,
      label,
      seats: Math.floor(seats),
    });
    setCreateBusy(false);
    if (!res.ok) {
      setSaveErr(
        res.code === "code_exists"
          ? "Ce code de table existe déjà sur cette terrasse."
          : res.code === "invalid_code"
            ? "Code invalide."
            : res.code === "terrace_not_found"
              ? "Terrasse inactive ou introuvable."
              : "Création impossible.",
      );
      return;
    }
    setNewCode("");
    setNewLabel("");
    setNewSeats("4");
    setTables((prev) => [...prev, res.table].sort(sortTables));
  };

  const terracesEmpty = !loadingTerraces && terraces.length === 0;

  return (
    <motion.div
      key="terrace-tables-settings"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mb-4">
        <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Tables par terrasse</h2>
        <p className="mt-1 text-xs text-white/40">
          Chaque <strong className="text-white/55">table</strong> est liée au point de vente / terrasse correspondant à la
          caisse comptoir. Les codes sont uniques par terrasse (lettres, chiffres, tirets ou soulignés). Utile pour le
          service en salle, les commandes et les rapports.
        </p>
        {loadErr ? (
          <p className="mt-2 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
            Impossible de charger les données (session ou droits Paramètres).
          </p>
        ) : null}
        {(loadingTerraces || loadingTables) && !loadErr ? (
          <p className="mt-2 text-xs text-white/45">Chargement…</p>
        ) : null}
        {readOnly ? (
          <p className="mt-2 text-[11px] text-white/35">Lecture seule — réservé aux comptes avec édition des paramètres.</p>
        ) : null}
      </div>

      <div className="mb-5">
        <label htmlFor={`${baseId}-terrace-select`} className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
          Terrasse (point de vente)
        </label>
        <select
          id={`${baseId}-terrace-select`}
          value={selectedPosId}
          onChange={(e) => setSelectedPosId(e.target.value)}
          disabled={loadingTerraces || terracesEmpty}
          className="max-w-xl rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {terraces.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({t.code}){t.active ? "" : " · inactive"}
            </option>
          ))}
        </select>
        {terracesEmpty ? (
          <p className="mt-2 text-xs text-white/45">Aucun point de vente défini — créez des caisses / terrasses depuis la trésorerie.</p>
        ) : null}
      </div>

      {saveErr ? (
        <p className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90" role="alert">
          {saveErr}
        </p>
      ) : null}

      {!readOnly && selectedPosId && !terracesEmpty ? (
        <form
          onSubmit={(ev) => void createTable(ev)}
          className="mb-6 rounded-xl border border-white/10 bg-black/20 p-4"
        >
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Nouvelle table · {selectedTerraceLabel}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-[100px]">
              <label htmlFor={`${baseId}-new-code`} className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Code
              </label>
              <input
                id={`${baseId}-new-code`}
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="ex. T12"
                disabled={loadingTables}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-white/35 focus:ring-2 focus:ring-brand-orange/40"
              />
            </div>
            <div className="min-w-[180px] flex-1">
              <label htmlFor={`${baseId}-new-label`} className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Libellé
              </label>
              <input
                id={`${baseId}-new-label`}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="ex. Terrasse couverte — table 12"
                disabled={loadingTables}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:ring-2 focus:ring-brand-orange/40"
              />
            </div>
            <div className="w-[88px]">
              <label htmlFor={`${baseId}-new-seats`} className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Couverts
              </label>
              <input
                id={`${baseId}-new-seats`}
                type="number"
                min={1}
                max={99}
                value={newSeats}
                onChange={(e) => setNewSeats(e.target.value)}
                disabled={loadingTables}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
              />
            </div>
            <button
              type="submit"
              disabled={loadingTables || createBusy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-orange/35 bg-brand-orange/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-brand-cream transition-colors hover:bg-brand-orange/20 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {createBusy ? "…" : "Ajouter"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Libellé</th>
              <th className="px-4 py-3 text-center">Couverts</th>
              <th className="px-4 py-3 text-center">Actif</th>
              {!readOnly ? <th className="px-4 py-3 text-right"> </th> : null}
            </tr>
          </thead>
          <tbody>
            {!selectedPosId || terracesEmpty ? (
              <tr>
                <td colSpan={readOnly ? 4 : 5} className="px-4 py-10 text-center text-white/45">
                  Sélectionnez une terrasse pour afficher les tables.
                </td>
              </tr>
            ) : tables.length === 0 && !loadingTables ? (
              <tr>
                <td colSpan={readOnly ? 4 : 5} className="px-4 py-10 text-center text-white/45">
                  Aucune table pour cette terrasse. Ajoutez-en une ci-dessus.
                </td>
              </tr>
            ) : (
              tables.map((r) => (
                <tr key={r.id} className="border-b border-white/5">
                  <td className="px-4 py-2 align-top">
                    <label className="sr-only" htmlFor={`${baseId}-code-${r.id}`}>
                      Code {r.id}
                    </label>
                    <input
                      id={`${baseId}-code-${r.id}`}
                      value={r.code}
                      readOnly={readOnly}
                      onChange={(e) => updateRowLocal(r.id, { code: e.target.value })}
                      className="w-full min-w-[72px] rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-brand-cream/85 outline-none read-only:cursor-not-allowed read-only:opacity-60 focus:ring-1 focus:ring-brand-orange/40"
                    />
                  </td>
                  <td className="px-4 py-2 align-top">
                    <label className="sr-only" htmlFor={`${baseId}-label-${r.id}`}>
                      Libellé {r.code}
                    </label>
                    <input
                      id={`${baseId}-label-${r.id}`}
                      value={r.label}
                      readOnly={readOnly}
                      onChange={(e) => updateRowLocal(r.id, { label: e.target.value })}
                      className="w-full min-w-[160px] rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-sm text-white outline-none read-only:cursor-not-allowed read-only:opacity-60 focus:ring-1 focus:ring-brand-orange/40"
                    />
                  </td>
                  <td className="px-4 py-2 align-top">
                    <label className="sr-only" htmlFor={`${baseId}-seats-${r.id}`}>
                      Couverts {r.code}
                    </label>
                    <input
                      id={`${baseId}-seats-${r.id}`}
                      type="number"
                      min={1}
                      max={99}
                      value={r.seats}
                      readOnly={readOnly}
                      onChange={(e) =>
                        updateRowLocal(r.id, { seats: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })
                      }
                      className="w-20 rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-center text-sm text-white outline-none read-only:cursor-not-allowed read-only:opacity-60 focus:ring-1 focus:ring-brand-orange/40"
                    />
                  </td>
                  <td className="px-4 py-2 text-center align-top">
                    <input
                      type="checkbox"
                      checked={r.active}
                      disabled={readOnly}
                      onChange={(e) => updateRowLocal(r.id, { active: e.target.checked })}
                      className="h-4 w-4 accent-brand-orange disabled:opacity-50"
                      aria-label={`Actif ${r.code}`}
                    />
                  </td>
                  {!readOnly ? (
                    <td className="px-4 py-2 text-right align-top">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={rowBusy === r.id || deleteBusy === r.id || loadingTables}
                          onClick={() => void saveRow(r)}
                          className="rounded-lg bg-gradient-to-r from-brand-red to-brand-red-orange px-3 py-1.5 text-xs font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:opacity-45"
                        >
                          {rowBusy === r.id ? "…" : "Enregistrer"}
                        </button>
                        <button
                          type="button"
                          disabled={rowBusy === r.id || deleteBusy === r.id || loadingTables}
                          onClick={() => void deleteRow(r.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-100/90 transition-colors hover:bg-rose-500/20 disabled:opacity-45"
                          title="Supprimer cette table"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          {deleteBusy === r.id ? "…" : ""}
                        </button>
                      </div>
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
