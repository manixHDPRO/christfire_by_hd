import { useAuth } from "@/auth/AuthContext";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  apiCheckoutFloorTab,
  apiDeleteFloorTab,
  apiGetFloorTabsBoard,
  apiGetFloorTab,
  apiGetTreasuryCashDayStatus,
  apiGetCounterSaleMenu,
  apiListClients,
  apiListCounterSalePoints,
  apiListCounterSales,
  apiOpenFloorTab,
  apiPutFloorTabLines,
  type CounterSalePointOfSale,
} from "@/lib/api";
import { generateFloorAdditionSlipPdf80Mm } from "@/lib/floorSlipPdf80mm";
import { userHasPermission } from "@/lib/permissions";
import type { Client, CounterSaleMenuItem, FloorBoardCell, FloorServiceTabDetail, ReservationPaymentMethod } from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import { DoorOpen, Minus, Plus, Printer, ShoppingCart, UtensilsCrossed } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const METHODS: ReservationPaymentMethod[] = ["Espèces", "Carte", "Virement", "Autre"];

function floorCdfToUsd(cdf: number, cdfPerUsd: number): number | null {
  if (!Number.isFinite(cdfPerUsd) || cdfPerUsd <= 0 || !Number.isFinite(cdf)) return null;
  return cdf / cdfPerUsd;
}

function formatFloorUsdApprox(usd: number): string {
  return usd.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function saleDateKey(createdAt: string): string {
  return createdAt.slice(0, 10);
}

function insufficientPosStockMessage(d: { itemLabel?: string; requestedQty?: number; availableQty?: number }): string {
  const name = d.itemLabel?.trim() || "Article";
  const req = d.requestedQty ?? 0;
  const avail = d.availableQty ?? 0;
  return `${name} : besoin de ${req} unité(s), seulement ${avail} disponible(s) à l’emplacement de cette terrasse/caisse. Réapprovisionnez l’emplacement ou effectuez un transfert depuis le dépôt.`;
}

function floorErrorMessage(code: string): string {
  switch (code) {
    case "insufficient_pos_stock":
      return "Stock insuffisant à ce point de vente pour au moins un article.";
    case "item_not_on_pos_catalog":
      return "Cet article n’est pas proposé sur le catalogue de ce point de vente (logistique).";
    case "unknown_or_unpriced_item":
      return "Un article n’est pas vendable ou n’a pas de prix de vente (Paramètres / stocks).";
    case "empty_tab":
      return "Ajoutez au moins un article avant d’encaisser.";
    case "table_busy":
      return "Cette table est déjà prise par un autre serveur.";
    case "forbidden_tab":
      return "Vous ne pouvez pas modifier cette addition.";
    case "floor_serve_role_required":
      return "Seuls les membres avec le rôle « service en salle » peuvent ouvrir une table ou modifier le panier.";
    case "tab_has_lines":
      return "Videz ou encaissez l’addition avant de fermer la table.";
    case "cash_day_not_opened":
      return "La journée caisse n’est pas ouverte : les ventes sont bloquées.";
    case "forbidden_point_of_sale":
      return "Ce point de vente ne vous est pas assigné.";
    case "unknown_client":
      return "Client introuvable.";
    case "forbidden":
      return "Cette action n’est pas autorisée pour votre rôle.";
    default:
      return "L’opération a échoué. Réessayez.";
  }
}

function linesRecord(tab: Pick<FloorServiceTabDetail, "lines">): Record<string, number> {
  const r: Record<string, number> = {};
  for (const ln of tab.lines) r[ln.itemId] = ln.qty;
  return r;
}

export function ServiceSalle() {
  const { user } = useAuth();
  const treasuryView = !!(user && userHasPermission(user, "finance.treasury"));
  const hasFloorServe = !!(user && userHasPermission(user, "sales.floor"));
  const canEncashFloorTab = !!(user && userHasPermission(user, "finance.counter"));
  /** Comptoir encaissement terrasse sans rôle « servir » : voir additions, encaisser, sans ouvrir table ni lignes catalogue. */
  const counterOnlyCashier = !!(user && canEncashFloorTab && !hasFloorServe && !treasuryView);

  const [pointsOfSale, setPointsOfSale] = useState<CounterSalePointOfSale[]>([]);
  const [pointOfSaleId, setPointOfSaleId] = useState("");
  const [menu, setMenu] = useState<CounterSaleMenuItem[]>([]);
  const [cdfPerUsd, setCdfPerUsd] = useState(2850);

  const [board, setBoard] = useState<FloorBoardCell[] | null>(null);
  const [hiddenBusyTables, setHiddenBusyTables] = useState(0);
  const [boardErr, setBoardErr] = useState(false);

  const [selectedTableId, setSelectedTableId] = useState("");
  const [tabDetail, setTabDetail] = useState<FloorServiceTabDetail | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [linesBusy, setLinesBusy] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);

  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [sales, setSales] = useState<Awaited<ReturnType<typeof apiListCounterSales>>>(null);
  const [menuQuery, setMenuQuery] = useState("");

  const [method, setMethod] = useState<ReservationPaymentMethod>("Espèces");
  const [note, setNote] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [cashDayToday, setCashDayToday] = useState<Awaited<ReturnType<typeof apiGetTreasuryCashDayStatus>>>(null);

  const reloadBoard = useCallback(async (posId: string) => {
    if (!posId) {
      setBoard(null);
      setHiddenBusyTables(0);
      return;
    }
    const b = await apiGetFloorTabsBoard(posId);
    setBoardErr(b === null);
    if (b) {
      setBoard(b.board);
      setHiddenBusyTables(b.hiddenBusyTables);
    } else {
      setBoard([]);
      setHiddenBusyTables(0);
    }
  }, []);

  const reloadMenuOnly = useCallback(async (posId: string) => {
    if (!posId) {
      setMenu([]);
      return;
    }
    const menuRes = await apiGetCounterSaleMenu(posId);
    if (menuRes?.items) {
      setMenu(menuRes.items);
      setCdfPerUsd(menuRes.cdfPerUsd);
    } else {
      setMenu([]);
    }
  }, []);

  const reloadCore = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [pos, cd, saleList, cl] = await Promise.all([
      apiListCounterSalePoints(),
      apiGetTreasuryCashDayStatus(),
      apiListCounterSales({
        from: localDateKey(new Date(Date.now() - 86400000 * 7)),
      }),
      userHasPermission(user, "directory.clients") ? apiListClients() : Promise.resolve([] as Client[] | null),
    ]);
    setCashDayToday(cd);
    setSales(saleList ?? []);
    setLoadErr(saleList === null);
    if (Array.isArray(cl) && cl.length > 0) setClients(cl);
    else setClients([]);

    if (pos?.length) {
      setPointsOfSale(pos);
      setPointOfSaleId((prev) => {
        if (prev && pos.some((p) => p.id === prev)) return prev;
        return pos.find((p) => p.isMain)?.id ?? pos[0].id;
      });
    } else {
      setPointsOfSale([]);
      setPointOfSaleId("");
      setMenu([]);
      setBoard(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void reloadCore();
  }, [reloadCore]);

  useEffect(() => {
    if (!pointOfSaleId) {
      setBoard(null);
      setMenu([]);
      setHiddenBusyTables(0);
      setSelectedTableId("");
      setTabDetail(null);
      return;
    }
    void reloadMenuOnly(pointOfSaleId);
    void reloadBoard(pointOfSaleId);
    setSelectedTableId("");
    setTabDetail(null);
  }, [pointOfSaleId, reloadBoard, reloadMenuOnly]);

  useEffect(() => {
    if (!pointOfSaleId) return;
    const id = window.setInterval(() => {
      void reloadBoard(pointOfSaleId);
    }, 28000);
    return () => window.clearInterval(id);
  }, [pointOfSaleId, reloadBoard]);

  useEffect(() => {
    if (!board || !selectedTableId || !tabDetail) return;
    const cell = board.find((c) => c.tableId === selectedTableId);
    if (!cell) return;
    if (cell.vacant) setTabDetail(null);
    else if (cell.tabId !== tabDetail.id) setTabDetail(null);
  }, [board, selectedTableId, tabDetail]);

  useEffect(() => {
    if (!selectedTableId || board === null) return;
    const exists = board.some((c) => c.tableId === selectedTableId);
    if (!exists) {
      setSelectedTableId("");
      setTabDetail(null);
    }
  }, [board, selectedTableId]);

  const selectedCell = useMemo(
    () => (board && selectedTableId ? board.find((c) => c.tableId === selectedTableId) : undefined),
    [board, selectedTableId],
  );

  const filteredMenu = useMemo(() => {
    const q = menuQuery.trim().toLowerCase();
    if (!q) return menu;
    return menu.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.code.toLowerCase().includes(q) ||
        i.unitLabel.toLowerCase().includes(q),
    );
  }, [menu, menuQuery]);

  const encaissementBlocked =
    !!user &&
    !userHasPermission(user, "finance.treasury") &&
    cashDayToday !== null &&
    !cashDayToday.opened;

  const syncTabFromBoard = useCallback(
    async (tableId: string, tabId: string) => {
      setPanelLoading(true);
      try {
        const det = await apiGetFloorTab(tabId);
        if (det?.diningTableId === tableId) setTabDetail(det);
        else setTabDetail(null);
      } finally {
        setPanelLoading(false);
      }
    },
    [],
  );

  const handlePickTable = useCallback(
    async (cell: FloorBoardCell) => {
      setFormErr(null);
      setSelectedTableId(cell.tableId);
      if (cell.vacant) {
        setTabDetail(null);
        return;
      }
      if (!cell.tabId) {
        setTabDetail(null);
        return;
      }
      if (!cell.canEdit && !counterOnlyCashier) {
        setTabDetail(null);
        return;
      }
      await syncTabFromBoard(cell.tableId, cell.tabId);
    },
    [counterOnlyCashier, syncTabFromBoard],
  );

  const handleOpenTable = useCallback(async () => {
    if (!pointOfSaleId || !selectedTableId || !selectedCell?.vacant) return;
    setFormErr(null);
    setPanelLoading(true);
    try {
      const res = await apiOpenFloorTab({ pointOfSaleId, diningTableId: selectedTableId });
      if (!res.ok) {
        setFormErr(
          res.code === "table_busy" && res.openedByName
            ? `Table déjà utilisée (${res.openedByName}).`
            : floorErrorMessage(res.code),
        );
        return;
      }
      setTabDetail(res.tab);
      await reloadBoard(pointOfSaleId);
    } finally {
      setPanelLoading(false);
    }
  }, [pointOfSaleId, reloadBoard, selectedCell?.vacant, selectedTableId]);

  const persistLinesForTab = useCallback(
    async (tab: FloorServiceTabDetail, rec: Record<string, number>) => {
      const linesPayload = Object.entries(rec).map(([itemId, qty]) => ({ itemId, qty }));
      const res = await apiPutFloorTabLines(tab.id, { lines: linesPayload });
      if (!res.ok) {
        if (res.code === "insufficient_pos_stock") {
          setFormErr(insufficientPosStockMessage(res));
          void reloadMenuOnly(pointOfSaleId);
          return false;
        }
        setFormErr(floorErrorMessage(res.code));
        return false;
      }
      setTabDetail(res.tab);
      await Promise.all([reloadBoard(pointOfSaleId), reloadMenuOnly(pointOfSaleId)]);
      return true;
    },
    [pointOfSaleId, reloadBoard, reloadMenuOnly],
  );

  const bump = useCallback(
    async (itemId: string, delta: number) => {
      if (!tabDetail || encaissementBlocked) return;
      const rec = { ...linesRecord(tabDetail) };
      const cur = rec[itemId] ?? 0;
      const next = Math.max(0, cur + delta);
      const mi = menu.find((m) => m.id === itemId);
      const shelfSlot =
        mi?.requiresPosStock && typeof mi.qtyAtSaleLocation === "number" ? mi.qtyAtSaleLocation : null;
      const maxTotalForTab = shelfSlot !== null ? cur + shelfSlot : Number.POSITIVE_INFINITY;
      if (delta > 0 && shelfSlot !== null && next > maxTotalForTab) {
        const addQty = next - cur;
        setFormErr(
          insufficientPosStockMessage({
            itemLabel: mi?.label,
            requestedQty: addQty,
            availableQty: shelfSlot,
          }),
        );
        return;
      }
      if (next <= 0) delete rec[itemId];
      else rec[itemId] = next;

      setLinesBusy(true);
      setFormErr(null);
      try {
        await persistLinesForTab(tabDetail, rec);
      } finally {
        setLinesBusy(false);
      }
    },
    [encaissementBlocked, menu, persistLinesForTab, tabDetail],
  );

  const printAdditionSlip = useCallback(() => {
    if (!tabDetail || tabDetail.lines.length === 0 || !user) return;
    setFormErr(null);
    const posLabel =
      pointsOfSale.find((p) => p.id === tabDetail.pointOfSaleId)?.label ?? tabDetail.pointOfSaleId;

    void (async () => {
      try {
        const doc = await generateFloorAdditionSlipPdf80Mm({
          tab: tabDetail,
          pointOfSaleLabel: posLabel,
          serveurName: tabDetail.openedByName?.trim() || user.name,
          cdfPerUsd,
        });

        const blob = doc.output("blob");
        const blobUrl = URL.createObjectURL(blob);
        const w = window.open(blobUrl, "_blank", "noopener,noreferrer");

        window.setTimeout(() => {
          if (w) {
            try {
              w.focus();
              w.print();
            } catch {
              /* Lecteur PDF navigateur — l’utilisateur peut imprimer (Ctrl+P) */
            }
          } else {
            setFormErr("Autorisez les fenêtres pop-up pour ouvrir le PDF ticket caisse (80 × ≥70 mm) à l’impression.");
            URL.revokeObjectURL(blobUrl);
            return;
          }
        }, 900);

        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 600_000);
      } catch {
        setFormErr("Impossible de générer le PDF ticket caisse (80 mm de large). Réessayez.");
      }
    })();
  }, [cdfPerUsd, pointsOfSale, tabDetail, user]);

  const checkout = useCallback(async () => {
    setFormErr(null);
    if (!canEncashFloorTab) return;
    if (!tabDetail || tabDetail.lines.length === 0) {
      setFormErr("Ajoutez au moins un article avant d’encaisser.");
      return;
    }
    setSubmitBusy(true);
    try {
      const res = await apiCheckoutFloorTab(tabDetail.id, {
        method,
        note: note.trim(),
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
      });
      if (!res.ok) {
        if (res.code === "insufficient_pos_stock") {
          setFormErr(insufficientPosStockMessage(res));
          void reloadMenuOnly(pointOfSaleId);
          return;
        }
        setFormErr(floorErrorMessage(res.code));
        return;
      }
      setNote("");
      setClientId("");
      setMethod("Espèces");
      setTabDetail(null);
      setSelectedTableId("");
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2200);
      await Promise.all([reloadCore(), reloadBoard(pointOfSaleId)]);
    } finally {
      setSubmitBusy(false);
    }
  }, [canEncashFloorTab, clientId, method, note, pointOfSaleId, reloadBoard, reloadCore, reloadMenuOnly, tabDetail]);

  const closeEmptyTab = useCallback(async () => {
    if (!tabDetail || tabDetail.lines.length > 0) return;
    setFormErr(null);
    setVoidBusy(true);
    try {
      const res = await apiDeleteFloorTab(tabDetail.id);
      if (!res.ok) {
        setFormErr(floorErrorMessage(res.code));
        return;
      }
      setTabDetail(null);
      await reloadBoard(pointOfSaleId);
    } finally {
      setVoidBusy(false);
    }
  }, [pointOfSaleId, reloadBoard, tabDetail]);

  const todayKey = useMemo(() => localDateKey(new Date()), []);
  const todayStats = useMemo(() => {
    if (!sales) return { total: 0, n: 0 };
    let total = 0;
    let n = 0;
    for (const s of sales) {
      if (saleDateKey(s.createdAt) !== todayKey) continue;
      if (!treasuryView && s.createdByUserId !== user?.id) continue;
      total += s.amountCdf;
      n += 1;
    }
    return { total, n };
  }, [sales, todayKey, treasuryView, user?.id]);

  const todayStatsUsd = useMemo(
    () => floorCdfToUsd(todayStats.total, cdfPerUsd),
    [todayStats.total, cdfPerUsd],
  );

  const myRecentSales = useMemo(() => {
    if (!sales) return [];
    return sales.filter((s) => treasuryView || s.createdByUserId === user?.id).slice(0, 35);
  }, [sales, treasuryView, user?.id]);

  const clientsSorted = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [clients],
  );

  const boardSorted = useMemo(() => {
    if (!board) return [];
    return [...board].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  }, [board]);

  return (
    <div>
      <Breadcrumb items={[{ label: "Finance", to: "/finance" }, { label: "Service salle" }]} />
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-500/35 bg-orange-500/10 text-brand-cream">
            <UtensilsCrossed className="h-6 w-6" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-4xl tracking-wide text-white">Service salle</h1>
            <p className="mt-1 max-w-3xl text-sm text-white/45">
              {counterOnlyCashier ? (
                <>
                  Vue <strong className="text-white/65">caisse terrasse</strong> : toutes les additions ouvertes de ce point
                  de vente sont visibles pour <strong className="text-white/55">encaisser</strong> et{" "}
                  <strong className="text-white/55">libérer la table</strong> après paiement — sans ouverture de table ni
                  modification du catalogue (réservé au service en salle).
                </>
              ) : (
                <>
                  Chaque <strong className="text-white/55">table</strong> a son addition : vous ne voyez que les tables{" "}
                  <strong className="text-white/55">libres</strong> et celles que{" "}
                  <strong className="text-white/55">vous</strong> avez ouvertes.{" "}
                  {treasuryView ? (
                    <span>
                      Avec la trésorerie, <strong className="text-white/65">toutes</strong> les tables du plan restent visibles
                      pour superviser le service.
                    </span>
                  ) : (
                    <span>Les tables utilisées par un autre serveur n’apparaissent pas dans votre plan.</span>
                  )}{" "}
                  {treasuryView ? (
                    <span>
                      Vous voyez aussi <strong className="text-white/65">toutes</strong> les ventes dans l’historique.
                    </span>
                  ) : (
                    <span>Vous voyez uniquement <strong className="text-white/65">vos</strong> ventes récentes en bas.</span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
      </header>

      {user ? (
        <p className="mb-6 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs text-white/50">
          Connecté · <strong className="text-white/65">{user.name}</strong>
          {!treasuryView ? <> — liste des ventes : uniquement vos encaissements pour cette vue.</> : null}
        </p>
      ) : null}

      {encaissementBlocked ? (
        <div
          className="mb-6 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-50/95"
          role="status"
        >
          <p className="font-semibold text-amber-100/95">Encaissements suspendus</p>
          <p className="mt-1 text-amber-100/80">
            La journée d’exploitation n’a pas encore été ouverte par la trésorerie pour aujourd’hui.
          </p>
        </div>
      ) : null}

      <div className="mb-8 grid gap-6 xl:grid-cols-12">
        <section className="rounded-2xl border border-white/10 bg-black/20 p-4 xl:col-span-4">
          <div className="mb-4">
            <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Terrasse / point de vente</label>
            <select
              value={pointOfSaleId}
              onChange={(e) => setPointOfSaleId(e.target.value)}
              disabled={loading || pointsOfSale.length === 0}
              aria-label="Terrasse / point de vente"
              className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/35"
            >
              {pointsOfSale.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.code})
                </option>
              ))}
            </select>
          </div>

          <h2 className="mb-2 font-display text-sm tracking-wide text-white/85">Plan de salle</h2>
          {boardErr ? (
            <p className="text-xs text-brand-orange/90">Impossible de charger le plan.</p>
          ) : null}
          {loading ? <p className="mb-3 text-xs text-white/40">Chargement…</p> : null}

          {!boardSorted.length && !loading && pointOfSaleId ? (
            <div className="space-y-3">
              {!treasuryView && hiddenBusyTables > 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-4 text-xs text-white/45">
                  Pour le moment, les <strong className="text-white/60">{hiddenBusyTables}</strong> table(s) configurée(s) sont
                  toutes utilisées par d’autres membres du service — elles n’affichent pas sur votre vue. Réessayez lorsqu’une
                  table sera libérée après encaissement.
                </p>
              ) : null}
              {!treasuryView && hiddenBusyTables > 0 ? null : (
                <p className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-4 text-xs text-white/45">
                  Aucune table pour cette terrasse. Ajoutez-les dans <strong className="text-white/55">Paramètres</strong> ›
                  Tables par terrasse.
                </p>
              )}
            </div>
          ) : (
            <div className="grid max-h-[min(52vh,420px)] grid-cols-2 gap-2 overflow-auto pr-1 sm:grid-cols-3">
              {boardSorted.map((cell) => {
                const selected = selectedTableId === cell.tableId;
                let tone =
                  "border-white/12 bg-white/[0.03] hover:border-white/20";
                if (!cell.vacant) {
                  tone = "border-orange-500/35 bg-orange-500/[0.07] hover:border-orange-500/55";
                }
                if (selected) tone += " ring-2 ring-brand-orange ring-offset-2 ring-offset-black/40";

                const cellTotalUsd =
                  !cell.vacant && typeof cell.totalCdf === "number"
                    ? floorCdfToUsd(cell.totalCdf, cdfPerUsd)
                    : null;

                const subtitle = cell.vacant ? (
                  <span className="text-emerald-200/85">Libre</span>
                ) : (
                  <span className="text-orange-100/90">
                    {typeof cell.totalCdf === "number" && cellTotalUsd != null ? (
                      <span className="tabular-nums">{formatFloorUsdApprox(cellTotalUsd)} USD</span>
                    ) : typeof cell.totalCdf === "number" ? (
                      <span className="text-orange-200/65">Addition (taux indisponible)</span>
                    ) : (
                      "Addition"
                    )}
                    {typeof cell.lineCount === "number" ? ` · ${cell.lineCount} lignes` : null}
                    {(treasuryView || counterOnlyCashier) && cell.openedByName ? (
                      <span className="block truncate text-[9px] text-white/40">· {cell.openedByName}</span>
                    ) : null}
                  </span>
                );

                return (
                  <button
                    key={cell.tableId}
                    type="button"
                    onClick={() => void handlePickTable(cell)}
                    disabled={loading}
                    className={`rounded-xl border px-2.5 py-3 text-left text-xs outline-none transition-colors ${tone} disabled:opacity-45`}
                  >
                    <div className="font-mono text-sm font-semibold text-white">{cell.code}</div>
                    <div className="mt-0.5 truncate text-[11px] text-white/50">{cell.label}</div>
                    <div className="mt-2 text-[10px] text-white/40">{cell.seats} couv.</div>
                    <div className="mt-1.5 text-[10px] font-medium">{subtitle}</div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-black/20 p-4 xl:col-span-5">
          <div className="mb-4">
            <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
              {counterOnlyCashier
                ? "Catalogue (réservé au service en salle)"
                : "Catalogue (si une table avec addition est sélectionnée)"}
            </label>
            <input
              value={menuQuery}
              onChange={(e) => setMenuQuery(e.target.value)}
              placeholder="Chercher nom ou code…"
              disabled={!tabDetail || counterOnlyCashier}
              className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:ring-2 focus:ring-brand-orange/35 disabled:opacity-35"
            />
          </div>
          {counterOnlyCashier ? (
            <div className="py-14 text-center text-sm text-white/45">
              <p className="max-w-md mx-auto">
                Sélectionnez une <strong className="text-white/65">table occupée</strong> dans le plan pour voir l’addition à
                droite et l’encaisser — le catalogue n’est pas accessible avec votre profil caisse.
              </p>
            </div>
          ) : !tabDetail ? (
            <p className="py-16 text-center text-sm text-white/45">
              Choisissez une table avec laquelle vous travaillez, ou ouvrez une table libre. Le catalogue s’active seulement
              pour <strong className="text-white/65">votre</strong> addition (pas de panier partagé entre tables).
            </p>
          ) : loadErr ? (
            <p className="text-sm text-brand-orange/90">Chargement du menu impossible.</p>
          ) : (
            <div className="max-h-[min(60vh,520px)] space-y-1.5 overflow-auto pr-1">
              {filteredMenu.length === 0 && !loading ? (
                <p className="py-12 text-center text-sm text-white/45">
                  Aucun article avec prix de vente. Définissez un prix USD dans Logistique / stocks.
                </p>
              ) : (
                filteredMenu.map((i) => {
                  const qtyInTab = tabDetail.lines.find((l) => l.itemId === i.id)?.qty ?? 0;
                  const unitUsd = i.salePriceUsdCents / 100;
                  const maxQtyOnAddition =
                    i.requiresPosStock && typeof i.qtyAtSaleLocation === "number"
                      ? qtyInTab + i.qtyAtSaleLocation
                      : Number.POSITIVE_INFINITY;
                  return (
                    <div
                      key={i.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-white/88">{i.label}</p>
                        <p className="text-[11px] text-white/40">
                          {i.code} ·{" "}
                          <span className="tabular-nums font-medium text-white/55">{formatFloorUsdApprox(unitUsd)} USD</span> /
                          unité
                          {i.requiresPosStock && typeof i.qtyAtSaleLocation === "number" ? (
                            <>
                              {" "}
                              ·{" "}
                              <span className="text-amber-200/85">
                                Dispo encore à servir : {i.qtyAtSaleLocation}{" "}
                                <span className="text-white/35">
                                  (max. {qtyInTab + i.qtyAtSaleLocation} sur votre addition)
                                </span>
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Retirer ${i.label}`}
                          disabled={qtyInTab <= 0 || linesBusy || encaissementBlocked}
                          onClick={() => void bump(i.id, -1)}
                          className="rounded-lg border border-white/15 px-2 py-1 text-white/70 hover:bg-white/5 disabled:opacity-35"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-8 text-center font-mono text-sm text-brand-cream">{qtyInTab}</span>
                        <button
                          type="button"
                          aria-label={`Ajouter ${i.label}`}
                          disabled={
                            linesBusy ||
                            encaissementBlocked ||
                            qtyInTab >= maxQtyOnAddition
                          }
                          onClick={() => void bump(i.id, 1)}
                          className="rounded-lg border border-brand-orange/40 bg-brand-orange/15 px-2 py-1 text-brand-cream hover:bg-brand-orange/25 disabled:opacity-35"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4 xl:col-span-3">
          <motion.div layout className="rounded-2xl border border-orange-500/25 bg-orange-500/[0.06] p-4">
            <div className="mb-3 flex items-center gap-2 text-orange-100/95">
              <ShoppingCart className="h-5 w-5 shrink-0" aria-hidden />
              <h2 className="font-display text-lg tracking-wide text-white">Table sélectionnée</h2>
            </div>

            {!selectedTableId ? (
              <p className="text-sm text-white/45">Choisissez une table dans le plan.</p>
            ) : selectedTableId && !selectedCell ? (
              <div className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-3 text-sm text-white/70">
                <p>Cette table n’apparaît plus sur votre plan (elle est peut-être utilisée par un autre serveur).</p>
                <p className="mt-2 text-xs text-white/45">Sélectionnez une autre table ou attendez la prochaine mise à jour du plan.</p>
              </div>
            ) : panelLoading ? (
              <p className="text-sm text-white/45">Chargement de l’addition…</p>
            ) : selectedCell?.vacant ? (
              <div className="space-y-4">
                <p className="text-sm text-white/70">
                  Table <strong className="text-white/90">{selectedCell.code}</strong> ({selectedCell.label}) —{" "}
                  <span className="text-emerald-200/90">libre</span>.
                </p>
                {counterOnlyCashier ? (
                  <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/50">
                    L’ouverture de table est réservée au personnel avec le <strong className="text-white/65">service en salle</strong>.
                    Choisissez une table où une addition est déjà ouverte pour encaisser.
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={encaissementBlocked || loading}
                    onClick={() => void handleOpenTable()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-orange-500/35 bg-orange-600/85 py-3 text-sm font-semibold text-white shadow-lg hover:bg-orange-600 disabled:opacity-40"
                  >
                    <DoorOpen className="h-5 w-5" aria-hidden />
                    Ouvrir la table
                  </button>
                )}
              </div>
            ) : tabDetail ? (
              <>
                <p className="mb-3 text-[11px] text-white/40">
                  <span className="text-orange-100/85">N° Facture : {tabDetail.invoiceRef}</span>
                  <span className="text-white/55">
                    {" "}
                    · N° Table : {tabDetail.tableCode.trim() || tabDetail.tableLabel.trim() || "—"}
                  </span>
                </p>
                <ul className="mb-4 max-h-44 space-y-2 overflow-auto text-sm">
                  {tabDetail.lines.length === 0 ? (
                    <li className="text-white/40">Aucune ligne encore — utilisez le catalogue au centre.</li>
                  ) : (
                    tabDetail.lines.map((ln) => {
                      const lineUsd = floorCdfToUsd(ln.lineTotalCdf, cdfPerUsd);
                      return (
                        <li key={ln.itemId} className="flex justify-between gap-2 border-b border-white/5 pb-2 text-white/80">
                          <span className="min-w-0 truncate">{ln.label}</span>
                          <span className="shrink-0 text-right text-white/60 tabular-nums">
                            ×{ln.qty} ·{" "}
                            {lineUsd != null ? (
                              <>{formatFloorUsdApprox(lineUsd)} USD</>
                            ) : (
                              <span className="text-white/35">{ln.lineTotalCdf.toLocaleString("fr-FR")} FC</span>
                            )}
                          </span>
                        </li>
                      );
                    })
                  )}
                </ul>
                <div className="border-t border-white/10 pt-3">
                  <p className="text-lg font-semibold tabular-nums text-white">
                    {(() => {
                      const u = floorCdfToUsd(tabDetail.totalCdf, cdfPerUsd);
                      if (u != null) return <>Total {formatFloorUsdApprox(u)} USD</>;
                      return <>Total {tabDetail.totalCdf.toLocaleString("fr-FR")} FC</>;
                    })()}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={tabDetail.lines.length === 0}
                  title={counterOnlyCashier ? "Bon d’addition avec le nom du serveur indiqué en entête." : undefined}
                  onClick={() => printAdditionSlip()}
                  aria-label="Imprimer le bon PDF ticket caisse 80 mm"
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/[0.06] py-3 text-sm font-semibold text-white/90 transition-colors hover:bg-white/[0.1] disabled:opacity-35"
                >
                  <Printer className="h-5 w-5 shrink-0" aria-hidden />
                  Imprimer
                </button>

                {canEncashFloorTab ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                        Moyen de paiement
                      </label>
                      <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value as ReservationPaymentMethod)}
                        disabled={encaissementBlocked}
                        aria-label="Moyen de paiement"
                        className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/35"
                      >
                        {METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    {clients.length > 0 ? (
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                          Client lié (optionnel)
                        </label>
                        <select
                          value={clientId}
                          onChange={(e) => setClientId(e.target.value)}
                          aria-label="Client lié"
                          className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/35"
                        >
                          <option value="">— Aucune fiche —</option>
                          {clientsSorted.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Note caisse</label>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        disabled={encaissementBlocked}
                        className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/35"
                        placeholder="Couvert VIP, événement…"
                        maxLength={500}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 flex flex-col gap-2">
                  {canEncashFloorTab ? (
                    <button
                      type="button"
                      disabled={submitBusy || encaissementBlocked || tabDetail.lines.length === 0}
                      onClick={() => void checkout()}
                      className="w-full rounded-xl bg-gradient-to-r from-orange-700 to-orange-600 py-3 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-95 disabled:opacity-40"
                    >
                      {submitBusy ? "Encaissement…" : "Encaisser et libérer la table"}
                    </button>
                  ) : null}
                  {!counterOnlyCashier ? (
                    <button
                      type="button"
                      disabled={voidBusy || tabDetail.lines.length > 0 || encaissementBlocked}
                      onClick={() => void closeEmptyTab()}
                      title="À utiliser uniquement pour une ouverture par erreur, sans lignes au panier"
                      className="w-full rounded-xl border border-white/15 bg-black/35 py-2.5 text-xs text-white/60 hover:bg-black/45 disabled:opacity-35"
                    >
                      Annuler l’ouverture (sans lignes)
                    </button>
                  ) : null}
                </div>

                <AnimatePresence>
                  {savedFlash ? (
                    <motion.p
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-2 text-center text-xs text-emerald-300/95"
                    >
                      Vente enregistrée · table à nouveau libre sur le plan.
                    </motion.p>
                  ) : null}
                </AnimatePresence>
              </>
            ) : (
              <p className="text-sm text-white/45">Impossible de charger cette addition.</p>
            )}
            {formErr ? (
              <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                {formErr}
              </p>
            ) : null}
          </motion.div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/38">
              {treasuryView ? "Ventes du jour (liste complète ci-dessous)" : "Mes ventes aujourd’hui"}
            </p>
            <p className="mt-2 font-display text-2xl tabular-nums text-white">{todayStats.n}</p>
            <p className="mt-1 text-sm tabular-nums text-white/50">
              {todayStatsUsd != null
                ? `${formatFloorUsdApprox(todayStatsUsd)} USD cumulés`
                : `${todayStats.total.toLocaleString("fr-FR")} FC cumulés`}
            </p>
          </div>
        </aside>
      </div>

      <section className="rounded-2xl border border-white/10 bg-black/15 p-4">
        <h2 className="font-display text-lg tracking-wide text-brand-cream/90">
          Ventes récentes {treasuryView ? "(flux complet)" : "(mes ventes uniquement)"}
        </h2>
        {!sales ? (
          <p className="mt-4 text-sm text-white/45">Liste indisponible.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/38">
                <tr>
                  <th className="px-3 py-2 whitespace-nowrap">N° Facture</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Caisse</th>
                  <th className="px-3 py-2">Table</th>
                  <th className="px-3 py-2">Articles / libellé</th>
                  <th className="px-3 py-2 text-center">Lignes</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                  <th className="px-3 py-2">Paiement</th>
                  {treasuryView ? <th className="px-3 py-2">Serveur</th> : null}
                </tr>
              </thead>
              <tbody>
                {myRecentSales.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 text-white/80">
                    <td className="whitespace-nowrap px-3 py-2 text-xs font-mono tabular-nums text-orange-100/80">
                      {s.invoiceRef ?? "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-white/55">
                      {new Date(s.createdAt).toLocaleString("fr-FR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-2 text-xs text-white/55">
                      {s.pointOfSaleLabel ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-white/60">{s.diningTableCode ? `${s.diningTableCode}` : "—"}</td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-xs">{s.label}</td>
                    <td className="px-3 py-2 text-center text-xs tabular-nums">{s.linesCount ?? 0}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {floorCdfToUsd(s.amountCdf, cdfPerUsd) != null ? (
                        <>{formatFloorUsdApprox(floorCdfToUsd(s.amountCdf, cdfPerUsd)!)} USD</>
                      ) : (
                        <>{s.amountCdf.toLocaleString("fr-FR")} FC</>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{s.method}</td>
                    {treasuryView ? (
                      <td className="px-3 py-2 text-xs text-white/45">{s.createdByName ?? "—"}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
