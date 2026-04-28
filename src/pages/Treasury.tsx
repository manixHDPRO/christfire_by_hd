import { useAuth } from "@/auth/AuthContext";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  apiCreateTreasuryPointOfSale,
  apiGetCounterCashRegisterSituation,
  apiListCounterSalePoints,
  apiListTreasuryPointsOfSale,
  apiSubmitTreasuryRegisterReport,
  apiTreasuryRemittanceAccounts,
  apiOpenTreasuryCashDay,
  apiPatchTreasuryCashDayOpenings,
  apiTreasuryOverview,
  apiUpdateTreasuryPointOfSale,
  apiValidateReceptionRegisterReport,
  apiValidateTreasuryRegisterReport,
  type CounterSalePointOfSale,
  type TreasuryRemittanceAccount,
  type TreasuryPointOfSale,
} from "@/lib/api";
import { userHasPermission } from "@/lib/permissions";
import type {
  CounterCashRegisterSituation,
  ReceptionRegisterReport,
  TreasuryOverviewPayload,
  TreasuryRegisterReport,
} from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import { Landmark, Store } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

function treasuryPosToReportOption(p: TreasuryPointOfSale): CounterSalePointOfSale {
  return {
    id: p.id,
    code: p.code,
    label: p.label,
    sortOrder: p.sortOrder,
    isMain: p.isMain,
  };
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultRange(): { from: string; to: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return { from: localDateKey(start), to: localDateKey(end) };
}

function counterClosureSituationErrorMessage(code: string): string {
  switch (code) {
    case "cash_day_not_opened":
      return "La journée caisse n’est pas ouverte pour cette date.";
    case "forbidden_point_of_sale":
      return "Cette caisse ne vous est pas assignée.";
    case "unknown_point_of_sale":
      return "Caisse inconnue ou inactive.";
    case "unauthorized":
      return "Session expirée.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "Impossible de charger la situation journalière.";
  }
}

function reportFormError(code: string): string {
  switch (code) {
    case "unknown_point_of_sale":
      return "Point de vente invalide ou inactif.";
    case "report_already_validated":
      return "Ce rapport est déjà validé : il ne peut pas être modifié. Contactez la trésorerie en cas d’erreur.";
    case "validation_error":
      return "Vérifiez les montants (entiers ≥ 0) et la date.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "forbidden":
      return "Droits insuffisants.";
    case "forbidden_point_of_sale":
      return "Cette caisse ne vous est pas assignée.";
    case "no_point_of_sale_assignment":
      return "Aucune caisse comptoir ne vous est assignée. Contactez l’administrateur.";
    case "cash_day_not_opened":
      return "La trésorerie n’a pas encore ouvert la journée caisse pour cette date. Les mouvements sont bloqués jusqu’à l’ouverture.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "L’enregistrement a échoué. Réessayez.";
  }
}

function validateReportError(code: string, remittanceCurrency: "CDF" | "USD" = "CDF"): string {
  switch (code) {
    case "not_found":
      return "Rapport introuvable.";
    case "already_validated":
      return "Ce rapport a déjà été validé.";
    case "no_cash_account":
      return remittanceCurrency === "USD"
        ? "Aucun compte caisse physique USD actif. Créez-en un dans le livre de caisse."
        : "Aucun compte caisse physique CDF actif. Créez-en un dans le livre de caisse.";
    case "unknown_account":
      return "Compte caisse invalide.";
    case "validation_error":
      return "Vérifiez le montant et le compte.";
    case "forbidden":
      return "Réservé à la trésorerie.";
    case "unauthorized":
      return "Session expirée.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "La validation a échoué.";
  }
}

type ValidateModalState =
  | { kind: "counter"; report: TreasuryRegisterReport }
  | { kind: "reception"; report: ReceptionRegisterReport };

function varianceClassAmount(delta: number, currency: "CDF" | "USD") {
  if (delta === 0) return "text-emerald-300/90";
  const tol = currency === "USD" ? 5 : 500;
  if (Math.abs(delta) <= tol) return "text-amber-200/90";
  return "text-rose-300/90";
}

function amendCashDayErrorMessage(code: string): string {
  switch (code) {
    case "cash_day_not_opened":
      return "Cette journée n’est pas ouverte : impossible de mettre à jour les fonds.";
    case "unknown_point_of_sale":
      return "Une caisse comptoir est invalide ou inactive. Actualisez la liste.";
    case "validation_error":
      return "Vérifiez les montants saisis.";
    case "update_failed":
      return "L’enregistrement a échoué côté serveur. Réessayez.";
    case "forbidden":
      return "Droits insuffisants.";
    case "unauthorized":
      return "Session expirée.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "La correction a échoué. Réessayez.";
  }
}

function manageCaisseError(code: string): string {
  switch (code) {
    case "code_exists":
      return "Ce code est déjà utilisé pour une autre caisse ou un lieu de stock.";
    case "cannot_deactivate_last":
      return "Vous ne pouvez pas désactiver la dernière caisse active.";
    case "not_found":
      return "Caisse introuvable.";
    case "validation_error":
      return "Vérifiez le code, le libellé et l’ordre d’affichage.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "forbidden":
      return "Réservé aux profils avec droit « Trésorerie ».";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "L’enregistrement a échoué. Réessayez.";
  }
}

export function Treasury() {
  const { user } = useAuth();
  const canManageTreasury = userHasPermission(user, "finance.treasury");
  const canSeeCounterTreasury = userHasPermission(user, "finance.counter");
  const canSeeReceptionTreasury =
    userHasPermission(user, "lodging.reception_cash") || userHasPermission(user, "lodging.stay_reception");

  const [filterFrom, setFilterFrom] = useState(() => defaultRange().from);
  const [filterTo, setFilterTo] = useState(() => defaultRange().to);
  const [overview, setOverview] = useState<TreasuryOverviewPayload | null>(null);
  const [pointsOfSale, setPointsOfSale] = useState<CounterSalePointOfSale[]>([]);
  const [treasuryPointsAll, setTreasuryPointsAll] = useState<TreasuryPointOfSale[]>([]);
  const [treasuryPointsLoadFailed, setTreasuryPointsLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);

  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newIsMain, setNewIsMain] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const [editing, setEditing] = useState<TreasuryPointOfSale | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editSortStr, setEditSortStr] = useState("0");
  const [editActive, setEditActive] = useState(true);
  const [editIsMain, setEditIsMain] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const [pointOfSaleId, setPointOfSaleId] = useState("");
  const [reportDate, setReportDate] = useState(() => localDateKey(new Date()));
  const [openingStr, setOpeningStr] = useState("0");
  const [countedStr, setCountedStr] = useState("");
  const [notesCashier, setNotesCashier] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [counterClosureSituation, setCounterClosureSituation] = useState<CounterCashRegisterSituation | null>(null);
  const [counterClosureSituationLoading, setCounterClosureSituationLoading] = useState(false);
  const [counterClosureSituationErr, setCounterClosureSituationErr] = useState<string | null>(null);
  const [counterClosureSituationAck, setCounterClosureSituationAck] = useState(false);
  const [counterSituationRefreshKey, setCounterSituationRefreshKey] = useState(0);

  const [treasuryTab, setTreasuryTab] = useState<"synthese" | "caisses">("synthese");

  const [validateModal, setValidateModal] = useState<ValidateModalState | null>(null);
  const [remittanceAccounts, setRemittanceAccounts] = useState<TreasuryRemittanceAccount[]>([]);
  const [validateAmountStr, setValidateAmountStr] = useState("");
  const [validateAccountId, setValidateAccountId] = useState("");
  const [validateNote, setValidateNote] = useState("");
  const [validateErr, setValidateErr] = useState<string | null>(null);
  const [validateBusy, setValidateBusy] = useState(false);

  const [openCashDayBusy, setOpenCashDayBusy] = useState(false);
  const [openCashDayErr, setOpenCashDayErr] = useState<string | null>(null);
  const [openDayReceptionUsdStr, setOpenDayReceptionUsdStr] = useState("0");
  const [openDayNotes, setOpenDayNotes] = useState("");
  const [openDayCounterByPos, setOpenDayCounterByPos] = useState<Record<string, string>>({});

  const [amendReceptionUsdStr, setAmendReceptionUsdStr] = useState("0");
  const [amendCounterByPos, setAmendCounterByPos] = useState<Record<string, string>>({});
  const [amendCashDayBusy, setAmendCashDayBusy] = useState(false);
  const [amendCashDayErr, setAmendCashDayErr] = useState<string | null>(null);
  const [amendCashDayOkFlash, setAmendCashDayOkFlash] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const from = filterFrom.trim();
    const to = filterTo.trim();
    const manage = userHasPermission(user, "finance.treasury");
    const counterPerm = userHasPermission(user, "finance.counter");
    const posPromise = manage
      ? apiListTreasuryPointsOfSale()
      : counterPerm
        ? apiListCounterSalePoints()
        : Promise.resolve(null);
    const [ov, posRaw] = await Promise.all([apiTreasuryOverview({ from, to }), posPromise]);
    setLoading(false);
    if (ov === null) {
      setApiError(true);
      setOverview(null);
    } else {
      setApiError(false);
      setOverview(ov);
    }
    if (manage) {
      const tFull = posRaw as TreasuryPointOfSale[] | null;
      if (tFull !== null) {
        setTreasuryPointsLoadFailed(false);
        setTreasuryPointsAll(tFull);
        const active = tFull.filter((p) => p.active).map(treasuryPosToReportOption);
        if (active.length > 0) {
          setPointsOfSale(active);
          setPointOfSaleId((cur) => {
            if (cur && active.some((p) => p.id === cur)) return cur;
            const main = active.find((p) => p.isMain);
            return main?.id ?? active[0].id;
          });
        } else {
          setPointsOfSale([]);
          setPointOfSaleId("");
        }
      } else {
        setTreasuryPointsLoadFailed(true);
        setTreasuryPointsAll([]);
        setPointsOfSale([]);
        setPointOfSaleId("");
      }
    } else {
      setTreasuryPointsLoadFailed(false);
      setTreasuryPointsAll([]);
      if (!counterPerm) {
        setPointsOfSale([]);
        setPointOfSaleId("");
      } else {
        const c = posRaw as CounterSalePointOfSale[] | null;
        if (c !== null && c.length > 0) {
          setPointsOfSale(c);
          setPointOfSaleId((cur) => {
            if (cur && c.some((p) => p.id === cur)) return cur;
            const main = c.find((p) => p.isMain);
            return main?.id ?? c[0].id;
          });
        } else {
          setPointsOfSale([]);
          setPointOfSaleId("");
        }
      }
    }
  }, [filterFrom, filterTo, user]);

  const activePosIdsKey = useMemo(
    () =>
      treasuryPointsAll
        .filter((p) => p.active)
        .map((p) => p.id)
        .sort()
        .join(","),
    [treasuryPointsAll],
  );

  const counterTreasuryOpeningsSeedKey = useMemo(
    () =>
      (overview?.cashDayToday?.counterTreasuryOpenings ?? [])
        .map((c) => `${c.pointOfSaleId}:${c.openingFloatCdf}`)
        .sort()
        .join("|"),
    [overview?.cashDayToday?.counterTreasuryOpenings],
  );

  useEffect(() => {
    const cd = overview?.cashDayToday;
    if (!cd?.opened || amendCashDayBusy) return;
    setAmendReceptionUsdStr(String(cd.receptionOpeningFloatUsd ?? 0));
    const next: Record<string, string> = {};
    for (const p of treasuryPointsAll.filter((x) => x.active)) {
      const row = cd.counterTreasuryOpenings?.find((c) => c.pointOfSaleId === p.id);
      next[p.id] = row != null ? String(row.openingFloatCdf) : "";
    }
    setAmendCounterByPos(next);
  }, [
    overview?.cashDayToday?.opened,
    overview?.cashDayToday?.businessDate,
    overview?.cashDayToday?.receptionOpeningFloatUsd,
    counterTreasuryOpeningsSeedKey,
    activePosIdsKey,
    amendCashDayBusy,
    treasuryPointsAll,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (treasuryTab !== "caisses") setEditing(null);
  }, [treasuryTab]);

  useEffect(() => {
    if (treasuryTab !== "synthese") setValidateModal(null);
  }, [treasuryTab]);

  useEffect(() => {
    if (!validateModal) return;
    const counted =
      validateModal.kind === "counter"
        ? validateModal.report.countedCashCdf
        : validateModal.report.countedCashUsd;
    setValidateAmountStr(String(counted));
    setValidateNote("");
    setValidateErr(null);
    const currency = validateModal.kind === "reception" ? "USD" : "CDF";
    let cancelled = false;
    void (async () => {
      const acc = await apiTreasuryRemittanceAccounts({ currency });
      if (cancelled) return;
      setRemittanceAccounts(acc ?? []);
      setValidateAccountId((cur) => {
        const list = acc ?? [];
        if (cur && list.some((a) => a.id === cur)) return cur;
        return list[0]?.id ?? "";
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [validateModal]);

  useEffect(() => {
    if (!canSeeCounterTreasury) return;
    const pos = pointOfSaleId.trim();
    const date = reportDate.trim();
    if (!pos || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setCounterClosureSituation(null);
      setCounterClosureSituationLoading(false);
      setCounterClosureSituationErr(null);
      setCounterClosureSituationAck(false);
      return;
    }
    let cancelled = false;
    setCounterClosureSituationLoading(true);
    setCounterClosureSituationErr(null);
    setCounterClosureSituation(null);
    setCounterClosureSituationAck(false);
    void apiGetCounterCashRegisterSituation(date, pos).then((r) => {
      if (cancelled) return;
      setCounterClosureSituationLoading(false);
      if (r.ok) setCounterClosureSituation(r.situation);
      else setCounterClosureSituationErr(counterClosureSituationErrorMessage(r.code));
    });
    return () => {
      cancelled = true;
    };
  }, [canSeeCounterTreasury, pointOfSaleId, reportDate, counterSituationRefreshKey]);

  useEffect(() => {
    if (!counterClosureSituation) return;
    const t = counterClosureSituation.treasuryOpeningFloatCdf;
    if (t != null) setOpeningStr(String(t));
    else setOpeningStr("0");
  }, [counterClosureSituation]);

  const submitValidateReport = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validateModal) return;
      setValidateErr(null);
      const amount = Math.round(Number(validateAmountStr.replace(/\s/g, "").replace(",", ".")) || 0);
      if (!Number.isFinite(amount) || amount < 0) {
        setValidateErr("Montant à comptabiliser invalide (entier ≥ 0).");
        return;
      }
      const curLabel = validateModal.kind === "reception" ? "USD" : "CDF";
      if (amount > 0 && !validateAccountId.trim()) {
        setValidateErr(`Choisissez le compte caisse central (${curLabel}) qui recevra la remise.`);
        return;
      }
      setValidateBusy(true);
      try {
        if (validateModal.kind === "counter") {
          const res = await apiValidateTreasuryRegisterReport(validateModal.report.id, {
            targetAccountId: validateAccountId.trim() || undefined,
            amountCdf: amount,
            notesTreasury: validateNote.trim(),
          });
          if (!res.ok) {
            setValidateErr(validateReportError(res.code, "CDF"));
            return;
          }
        } else {
          const res = await apiValidateReceptionRegisterReport(validateModal.report.id, {
            targetAccountId: validateAccountId.trim() || undefined,
            amountUsd: amount,
            notesTreasury: validateNote.trim(),
          });
          if (!res.ok) {
            setValidateErr(validateReportError(res.code, "USD"));
            return;
          }
        }
        setValidateModal(null);
        await reload();
      } finally {
        setValidateBusy(false);
      }
    },
    [reload, validateAccountId, validateAmountStr, validateNote, validateModal],
  );

  const reportTableColSpan = canManageTreasury ? 11 : 10;
  const receptionReportTableColSpan = canManageTreasury ? 10 : 9;

  const rollupSorted = useMemo(() => {
    if (!overview?.counterRollup) return [];
    return [...overview.counterRollup].sort((a, b) => {
      const d = b.day.localeCompare(a.day);
      if (d !== 0) return d;
      return (a.pointOfSaleLabel ?? "").localeCompare(b.pointOfSaleLabel ?? "", "fr");
    });
  }, [overview]);

  const reportsSorted = useMemo(() => {
    if (!overview?.registerReports) return [];
    return [...overview.registerReports].sort((a, b) => {
      const d = b.reportDate.localeCompare(a.reportDate);
      if (d !== 0) return d;
      return (a.pointOfSaleLabel ?? "").localeCompare(b.pointOfSaleLabel ?? "", "fr");
    });
  }, [overview]);

  const receptionReportsSorted = useMemo(() => {
    if (!overview?.receptionRegisterReports) return [];
    return [...overview.receptionRegisterReports].sort((a, b) => b.reportDate.localeCompare(a.reportDate));
  }, [overview]);

  const applyFilter = useCallback(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!editing) return;
    setEditCode(editing.code);
    setEditLabel(editing.label);
    setEditSortStr(String(editing.sortOrder));
    setEditActive(editing.active);
    setEditIsMain(editing.isMain);
    setEditErr(null);
  }, [editing]);

  const submitCreateCaisse = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setCreateErr(null);
      const code = newCode.trim();
      const label = newLabel.trim();
      if (!code || !label) {
        setCreateErr("Renseignez le code et le libellé.");
        return;
      }
      setCreateBusy(true);
      try {
        const res = await apiCreateTreasuryPointOfSale({
          code,
          label,
          isMain: newIsMain,
        });
        if (!res.ok) {
          setCreateErr(manageCaisseError(res.code));
          return;
        }
        setNewCode("");
        setNewLabel("");
        setNewIsMain(false);
        await reload();
      } finally {
        setCreateBusy(false);
      }
    },
    [newCode, newLabel, newIsMain, reload],
  );

  const submitEditCaisse = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editing) return;
      setEditErr(null);
      const code = editCode.trim();
      const label = editLabel.trim();
      const sortOrder = Math.round(Number(editSortStr.replace(/\s/g, "").replace(",", ".")) || 0);
      if (!code || !label) {
        setEditErr("Renseignez le code et le libellé.");
        return;
      }
      if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
        setEditErr("Ordre d’affichage : entier entre 0 et 9999.");
        return;
      }
      setEditBusy(true);
      try {
        const res = await apiUpdateTreasuryPointOfSale(editing.id, {
          code,
          label,
          sortOrder,
          active: editActive,
          isMain: editIsMain,
        });
        if (!res.ok) {
          setEditErr(manageCaisseError(res.code));
          return;
        }
        setEditing(null);
        await reload();
      } finally {
        setEditBusy(false);
      }
    },
    [editActive, editCode, editIsMain, editLabel, editSortStr, editing, reload],
  );

  const submitReport = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormErr(null);
      const openingFloatCdf = Math.round(Number(openingStr.replace(/\s/g, "").replace(",", ".")) || 0);
      const countedCashCdf = Math.round(Number(countedStr.replace(/\s/g, "").replace(",", ".")) || 0);
      if (!Number.isFinite(countedCashCdf) || countedCashCdf < 0) {
        setFormErr("Indiquez le comptage caisse en CDF (entier ≥ 0).");
        return;
      }
      if (!Number.isFinite(openingFloatCdf) || openingFloatCdf < 0) {
        setFormErr("Fond de caisse ouverture invalide.");
        return;
      }
      if (!pointOfSaleId.trim()) {
        setFormErr("Choisissez une caisse.");
        return;
      }
      if (counterClosureSituationLoading) {
        setFormErr("Chargement de la situation journalière… Patientez un instant.");
        return;
      }
      if (counterClosureSituationErr) {
        setFormErr("Consultez la situation journalière : le chargement a échoué. Actualisez puis réessayez.");
        return;
      }
      if (!counterClosureSituation) {
        setFormErr("La situation journalière n’est pas disponible. Vérifiez la caisse et la date.");
        return;
      }
      if (!counterClosureSituationAck) {
        setFormErr(
          "Vous devez prendre connaissance de la situation journalière et cocher la confirmation avant de déposer le rapport.",
        );
        return;
      }
      setSubmitBusy(true);
      try {
        const res = await apiSubmitTreasuryRegisterReport({
          pointOfSaleId: pointOfSaleId.trim(),
          reportDate: reportDate.trim(),
          openingFloatCdf,
          countedCashCdf,
          notesCashier: notesCashier.trim(),
        });
        if (!res.ok) {
          setFormErr(reportFormError(res.code));
          return;
        }
        setCountedStr("");
        setNotesCashier("");
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 2500);
        await reload();
      } finally {
        setSubmitBusy(false);
      }
    },
    [
      countedStr,
      counterClosureSituation,
      counterClosureSituationAck,
      counterClosureSituationErr,
      counterClosureSituationLoading,
      notesCashier,
      openingStr,
      pointOfSaleId,
      reportDate,
      reload,
    ],
  );

  const cashDayToday = overview?.cashDayToday;

  const submitOpenCashDay = useCallback(async () => {
    setOpenCashDayErr(null);
    const receptionOpeningFloatUsd = Math.round(
      Number(openDayReceptionUsdStr.replace(/\s/g, "").replace(",", ".")) || 0,
    );
    if (!Number.isFinite(receptionOpeningFloatUsd) || receptionOpeningFloatUsd < 0) {
      setOpenCashDayErr("Indiquez un fond d’ouverture réception (USD) valide (entier ≥ 0).");
      return;
    }
    const counterOpenings: { pointOfSaleId: string; openingFloatCdf: number }[] = [];
    for (const p of treasuryPointsAll.filter((x) => x.active)) {
      const raw = (openDayCounterByPos[p.id] ?? "").trim();
      if (raw === "") continue;
      const v = Math.round(Number(raw.replace(/\s/g, "").replace(",", ".")) || 0);
      if (!Number.isFinite(v) || v < 0) {
        setOpenCashDayErr(`Fond d’ouverture invalide pour « ${p.label} » (entier ≥ 0).`);
        return;
      }
      counterOpenings.push({ pointOfSaleId: p.id, openingFloatCdf: v });
    }
    setOpenCashDayBusy(true);
    try {
      const res = await apiOpenTreasuryCashDay({
        notes: openDayNotes.trim(),
        receptionOpeningFloatUsd,
        counterOpenings,
      });
      if (!res.ok) {
        setOpenCashDayErr(
          res.code === "forbidden"
            ? "Droits insuffisants."
            : res.code === "unauthorized"
              ? "Session expirée."
              : res.code === "unknown_point_of_sale"
                ? "Une caisse comptoir est invalide ou inactive. Actualisez la liste."
                : res.code === "validation_error"
                  ? "Vérifiez les montants saisis."
                  : res.code === "network_error"
                    ? "Réseau indisponible."
                    : "L’ouverture a échoué. Réessayez.",
        );
        return;
      }
      if (res.alreadyOpen) {
        setOpenCashDayErr(
          "Cette journée est déjà ouverte. Utilisez « Corriger les fonds d’ouverture » pour modifier les montants.",
        );
        await reload();
        return;
      }
      setOpenDayNotes("");
      setOpenDayCounterByPos({});
      await reload();
    } finally {
      setOpenCashDayBusy(false);
    }
  }, [openDayCounterByPos, openDayNotes, openDayReceptionUsdStr, reload, treasuryPointsAll]);

  const submitAmendCashDayOpenings = useCallback(async () => {
    if (!cashDayToday?.opened) return;
    setAmendCashDayErr(null);
    const receptionOpeningFloatUsd = Math.round(
      Number(amendReceptionUsdStr.replace(/\s/g, "").replace(",", ".")) || 0,
    );
    if (!Number.isFinite(receptionOpeningFloatUsd) || receptionOpeningFloatUsd < 0) {
      setAmendCashDayErr("Indiquez un fond d’ouverture réception (USD) valide (entier ≥ 0).");
      return;
    }
    const counterOpenings: { pointOfSaleId: string; openingFloatCdf: number }[] = [];
    for (const p of treasuryPointsAll.filter((x) => x.active)) {
      const raw = (amendCounterByPos[p.id] ?? "").trim();
      if (raw === "") continue;
      const v = Math.round(Number(raw.replace(/\s/g, "").replace(",", ".")) || 0);
      if (!Number.isFinite(v) || v < 0) {
        setAmendCashDayErr(`Fond d’ouverture invalide pour « ${p.label} » (entier ≥ 0).`);
        return;
      }
      counterOpenings.push({ pointOfSaleId: p.id, openingFloatCdf: v });
    }
    setAmendCashDayBusy(true);
    try {
      const res = await apiPatchTreasuryCashDayOpenings({
        businessDate: cashDayToday.businessDate,
        receptionOpeningFloatUsd,
        counterOpenings,
      });
      if (!res.ok) {
        setAmendCashDayErr(amendCashDayErrorMessage(res.code));
        return;
      }
      setAmendCashDayOkFlash(true);
      window.setTimeout(() => setAmendCashDayOkFlash(false), 2500);
      await reload();
    } finally {
      setAmendCashDayBusy(false);
    }
  }, [amendCounterByPos, amendReceptionUsdStr, cashDayToday, reload, treasuryPointsAll]);

  return (
    <div>
      <Breadcrumb items={[{ label: "Finance", to: "/finance" }, { label: "Trésorerie" }]} />
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-orange/30 bg-brand-orange/10 text-brand-cream">
            <Landmark className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-4xl tracking-wide text-white">Trésorerie</h1>
            <p className="mt-1 max-w-3xl text-sm text-white/45">
              Synthèse des encaissements par <strong className="text-white/60">caisse / terrasse</strong>, rapports
              journaliers et, pour les profils habilités, <strong className="text-white/60">gestion des caisses</strong>{" "}
              dans l’onglet dédié.
            </p>
          </div>
        </div>
      </header>

      {cashDayToday && !cashDayToday.opened ? (
        <div
          className="mb-6 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-50/95"
          role="status"
        >
          <p className="font-semibold text-amber-100/95">Journée caisse non ouverte ({cashDayToday.businessDate})</p>
          <p className="mt-1 text-amber-100/80">
            Aucun encaissement ni rapport de clôture ne peut être enregistré pour cette date tant que la trésorerie n’a pas
            effectué l’ouverture.
          </p>
          {canManageTreasury ? (
            <div className="mt-4 space-y-4">
              <p className="text-amber-100/80">
                Vous pouvez indiquer ici les fonds d’ouverture (réception USD et, optionnellement, chaque caisse comptoir en
                CDF) : ils seront repris automatiquement dans les rapports de clôture.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">
                    Fond ouverture caisse réception (USD)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={openDayReceptionUsdStr}
                    onChange={(e) => setOpenDayReceptionUsdStr(e.target.value)}
                    disabled={openCashDayBusy}
                    className="w-full rounded-xl border border-amber-400/35 bg-black/25 px-3 py-2 font-mono text-sm text-amber-50 outline-none focus:ring-2 focus:ring-amber-400/40 disabled:opacity-50"
                    placeholder="0"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">
                    Note d’ouverture (optionnel)
                  </label>
                  <input
                    type="text"
                    value={openDayNotes}
                    onChange={(e) => setOpenDayNotes(e.target.value)}
                    disabled={openCashDayBusy}
                    className="w-full rounded-xl border border-amber-400/35 bg-black/25 px-3 py-2 text-sm text-amber-50 outline-none focus:ring-2 focus:ring-amber-400/40 disabled:opacity-50"
                    placeholder="Remarque interne…"
                  />
                </div>
              </div>
              {treasuryPointsAll.filter((p) => p.active).length > 0 ? (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">
                    Fonds d’ouverture comptoir (CDF), par caisse — laisser vide si le caissier saisit lui-même
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {treasuryPointsAll
                      .filter((p) => p.active)
                      .map((p) => (
                        <div key={p.id}>
                          <label className="mb-1 block text-[10px] text-amber-100/70">{p.label}</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={openDayCounterByPos[p.id] ?? ""}
                            onChange={(e) =>
                              setOpenDayCounterByPos((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            disabled={openCashDayBusy}
                            className="w-full rounded-lg border border-amber-400/30 bg-black/25 px-2.5 py-1.5 font-mono text-xs text-amber-50 outline-none focus:ring-2 focus:ring-amber-400/40 disabled:opacity-50"
                            placeholder="vide = caissier"
                          />
                        </div>
                      ))}
                  </div>
                </div>
              ) : treasuryPointsLoadFailed ? (
                <p className="text-xs text-amber-200/70">
                  Impossible de charger la liste des caisses : vous pouvez quand même ouvrir la journée avec le fond réception
                  uniquement.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={openCashDayBusy}
                  onClick={() => void submitOpenCashDay()}
                  className="rounded-xl border border-amber-400/50 bg-amber-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-50 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {openCashDayBusy ? "Ouverture…" : "Ouvrir la journée caisse"}
                </button>
                {openCashDayErr ? <span className="text-rose-200/90">{openCashDayErr}</span> : null}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-amber-100/70">Contactez la trésorerie pour débloquer les encaissements.</p>
          )}
        </div>
      ) : null}

      {cashDayToday?.opened && canManageTreasury ? (
        <div
          className="mb-6 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50/95"
          role="status"
        >
          <p className="font-semibold text-emerald-100/95">
            Journée caisse ouverte ({cashDayToday.businessDate}
            {cashDayToday.openedByName ? ` · ${cashDayToday.openedByName}` : ""})
          </p>
          <p className="mt-1 text-xs text-emerald-100/85">
            Fond réception (USD) à l’ouverture :{" "}
            <strong className="tabular-nums text-emerald-50">
              {(cashDayToday.receptionOpeningFloatUsd ?? 0).toLocaleString("fr-FR")} USD
            </strong>
            {cashDayToday.counterTreasuryOpenings && cashDayToday.counterTreasuryOpenings.length > 0 ? (
              <>
                {" "}
                · Comptoir :{" "}
                {cashDayToday.counterTreasuryOpenings
                  .map(
                    (r) =>
                      `${r.pointOfSaleLabel} ${r.openingFloatCdf.toLocaleString("fr-FR")} FC`,
                  )
                  .join(" · ")}
              </>
            ) : null}
          </p>
          <details className="mt-3 rounded-xl border border-emerald-400/25 bg-black/15 px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-emerald-200/90">
              Corriger les fonds d’ouverture
            </summary>
            <div className="mt-3 space-y-3 border-t border-emerald-500/20 pt-3">
              <p className="text-[11px] leading-relaxed text-emerald-100/75">
                Les montants enregistrés ici remplacent ceux de l’ouverture pour cette journée. Les rapports de clôture
                déjà déposés ne sont pas modifiés automatiquement ; en cas de nouvelle soumission, le serveur appliquera
                ces fonds corrigés.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-emerald-200/80">
                    Fond ouverture caisse réception (USD)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={amendReceptionUsdStr}
                    onChange={(e) => setAmendReceptionUsdStr(e.target.value)}
                    disabled={amendCashDayBusy}
                    className="w-full rounded-xl border border-emerald-400/35 bg-black/25 px-3 py-2 font-mono text-sm text-emerald-50 outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:opacity-50"
                    placeholder="0"
                  />
                </div>
              </div>
              {treasuryPointsAll.filter((p) => p.active).length > 0 ? (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-200/80">
                    Fonds comptoir (CDF) — laisser vide pour laisser le caissier saisir ; enregistrer efface les fonds
                    trésorerie non listés
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {treasuryPointsAll
                      .filter((p) => p.active)
                      .map((p) => (
                        <div key={p.id}>
                          <label className="mb-1 block text-[10px] text-emerald-100/70">{p.label}</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={amendCounterByPos[p.id] ?? ""}
                            onChange={(e) =>
                              setAmendCounterByPos((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            disabled={amendCashDayBusy}
                            className="w-full rounded-lg border border-emerald-400/30 bg-black/25 px-2.5 py-1.5 font-mono text-xs text-emerald-50 outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:opacity-50"
                            placeholder="vide = caissier"
                          />
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={amendCashDayBusy}
                  onClick={() => void submitAmendCashDayOpenings()}
                  className="rounded-xl border border-emerald-400/50 bg-emerald-600/25 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-50 hover:bg-emerald-600/35 disabled:opacity-50"
                >
                  {amendCashDayBusy ? "Enregistrement…" : "Enregistrer les corrections"}
                </button>
                {amendCashDayErr ? <span className="text-rose-200/90">{amendCashDayErr}</span> : null}
                {amendCashDayOkFlash ? (
                  <span className="text-xs text-emerald-200/90">Fonds mis à jour.</span>
                ) : null}
              </div>
            </div>
          </details>
        </div>
      ) : null}

      {canManageTreasury ? (
        <div
          className="mb-6 flex flex-wrap gap-2 border-b border-white/10 pb-1"
          role="tablist"
          aria-label="Sections trésorerie"
        >
          <button
            type="button"
            role="tab"
            id="tresorerie-tab-synthese"
            aria-selected={treasuryTab === "synthese"}
            aria-controls="tresorerie-panel-synthese"
            onClick={() => setTreasuryTab("synthese")}
            className={`rounded-t-lg px-4 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
              treasuryTab === "synthese"
                ? "border border-b-0 border-white/15 bg-white/[0.06] text-brand-cream/95"
                : "border border-transparent text-white/45 hover:bg-white/[0.04] hover:text-white/70"
            }`}
          >
            Synthèse & rapports
          </button>
          <button
            type="button"
            role="tab"
            id="tresorerie-tab-caisses"
            aria-selected={treasuryTab === "caisses"}
            aria-controls="tresorerie-panel-caisses"
            onClick={() => setTreasuryTab("caisses")}
            className={`rounded-t-lg px-4 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
              treasuryTab === "caisses"
                ? "border border-b-0 border-white/15 bg-white/[0.06] text-brand-cream/95"
                : "border border-transparent text-white/45 hover:bg-white/[0.04] hover:text-white/70"
            }`}
          >
            Gestion des caisses
          </button>
        </div>
      ) : null}

      {(!canManageTreasury || treasuryTab === "synthese") ? (
        <>
          <div
            id="tresorerie-panel-synthese"
            role="tabpanel"
            aria-labelledby={canManageTreasury ? "tresorerie-tab-synthese" : undefined}
            className="contents"
          >
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div>
          <label
            htmlFor="tresorerie-filter-du"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40"
          >
            Du
          </label>
          <input
            id="tresorerie-filter-du"
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
          />
        </div>
        <div>
          <label
            htmlFor="tresorerie-filter-au"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40"
          >
            Au
          </label>
          <input
            id="tresorerie-filter-au"
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
          />
        </div>
        <button
          type="button"
          onClick={() => void applyFilter()}
          className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/75 hover:bg-white/10"
        >
          Actualiser
        </button>
        <button
          type="button"
          onClick={() => {
            const d = defaultRange();
            setFilterFrom(d.from);
            setFilterTo(d.to);
          }}
          className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/45 hover:text-white/70"
        >
          7 derniers jours
        </button>
      </div>

      {apiError ? (
        <p className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
          Impossible de charger la trésorerie. Vérifiez le serveur et votre session.
          <button type="button" onClick={() => void reload()} className="ml-2 underline">
            Réessayer
          </button>
        </p>
      ) : null}

      <div
        className={`grid gap-8 ${canSeeCounterTreasury ? "xl:grid-cols-[minmax(0,400px)_1fr]" : ""}`}
      >
        {canSeeCounterTreasury ? (
        <motion.div
          className="h-fit rounded-2xl border border-white/10 glass-panel p-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="font-display text-lg tracking-wide text-brand-cream/95">Rapport de caisse</h2>
          <p className="mt-1 text-xs text-white/40">
            Un rapport par caisse et par jour. Après dépôt, il est{" "}
            <strong className="text-white/55">en attente de validation</strong> par la trésorerie avant comptabilisation
            au livre de caisse. Tant qu’il n’est pas validé, une nouvelle soumission remplace le précédent.
          </p>
          <form onSubmit={submitReport} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="tresorerie-rapport-pos"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
              >
                Caisse / terrasse
              </label>
              <select
                id="tresorerie-rapport-pos"
                value={pointOfSaleId}
                onChange={(e) => setPointOfSaleId(e.target.value)}
                disabled={apiError || pointsOfSale.length === 0}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              >
                {pointsOfSale.length === 0 ? (
                  <option value="">Chargement…</option>
                ) : (
                  pointsOfSale.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))
                )}
              </select>
            </div>
            {!loading && pointsOfSale.length === 0 ? (
              <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
                Aucune caisse comptoir ne vous est assignée. Un administrateur peut vous en attribuer dans{" "}
                <strong className="text-white/70">Paramètres → Utilisateurs</strong>.
              </p>
            ) : null}
            <div>
              <label
                htmlFor="tresorerie-rapport-date"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
              >
                Date du rapport
              </label>
              <input
                id="tresorerie-rapport-date"
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                disabled={apiError}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              />
            </div>

            {pointsOfSale.length > 0 && pointOfSaleId ? (
              <div className="rounded-xl border border-white/15 bg-black/25 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-brand-cream/95">Situation journalière (votre caisse)</h3>
                  <button
                    type="button"
                    onClick={() => setCounterSituationRefreshKey((k) => k + 1)}
                    disabled={counterClosureSituationLoading || apiError}
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/70 hover:bg-white/10 disabled:opacity-40"
                  >
                    Actualiser
                  </button>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                  Ventes enregistrées à <strong className="text-white/55">votre nom</strong> sur cette caisse et cette
                  date. L’<strong className="text-white/55">attendu en caisse</strong> = fond d’ouverture + espèces
                  système (ligne « Espèces enregistrées »).
                </p>
                {counterClosureSituationLoading ? (
                  <p className="mt-3 text-xs text-white/50">Chargement de la situation…</p>
                ) : counterClosureSituationErr ? (
                  <p className="mt-3 text-xs text-red-200/90" role="alert">
                    {counterClosureSituationErr}
                  </p>
                ) : counterClosureSituation ? (
                  <>
                    <dl className="mt-3 grid gap-2 text-sm">
                      <div className="flex justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 tabular-nums">
                        <dt className="text-white/45">Espèces enregistrées (système)</dt>
                        <dd className="font-medium text-white/90">
                          {counterClosureSituation.systemCashSalesCdf.toLocaleString("fr-CD")} FC
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 tabular-nums">
                        <dt className="text-white/45">Total ventes (toutes méthodes)</dt>
                        <dd className="font-medium text-white/80">
                          {counterClosureSituation.totalSalesCdf.toLocaleString("fr-CD")} FC
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 tabular-nums">
                        <dt className="text-white/45">Nombre de ventes saisies</dt>
                        <dd className="font-medium text-white/80">{counterClosureSituation.saleCount}</dd>
                      </div>
                    </dl>
                    <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-white/75">
                      <input
                        type="checkbox"
                        checked={counterClosureSituationAck}
                        onChange={(e) => setCounterClosureSituationAck(e.target.checked)}
                        className="mt-0.5 rounded border-white/25 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                      />
                      <span>
                        Je confirme avoir pris connaissance de cette situation journalière avant de déposer le rapport.
                      </span>
                    </label>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-white/45">Aucune donnée de situation.</p>
                )}
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Fond de caisse ouverture (CDF)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={openingStr}
                onChange={(e) => setOpeningStr(e.target.value)}
                disabled={apiError || counterClosureSituation?.treasuryOpeningFloatCdf != null}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
                placeholder="0"
              />
              {counterClosureSituation?.treasuryOpeningFloatCdf != null ? (
                <p className="mt-1 text-[10px] text-white/40">
                  Montant fixé par la trésorerie à l’ouverture de journée pour cette caisse.
                </p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Espèces comptées en caisse (CDF)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={countedStr}
                onChange={(e) => setCountedStr(e.target.value)}
                disabled={apiError}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
                placeholder="ex. 125000"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Commentaire caissier
              </label>
              <textarea
                rows={2}
                value={notesCashier}
                onChange={(e) => setNotesCashier(e.target.value)}
                disabled={apiError}
                className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
                placeholder="Remarques, régularisation, coffre…"
              />
            </div>
            {formErr ? (
              <p
                className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95"
                role="alert"
              >
                {formErr}
              </p>
            ) : null}
            <AnimatePresence>
              {savedFlash ? (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-emerald-300/90"
                >
                  Rapport déposé — en attente de validation trésorerie.
                </motion.p>
              ) : null}
            </AnimatePresence>
            <button
              type="submit"
              disabled={
                apiError ||
                submitBusy ||
                counterClosureSituationLoading ||
                !!counterClosureSituationErr ||
                !counterClosureSituation ||
                !counterClosureSituationAck
              }
              className="w-full rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange py-3 text-sm font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitBusy ? "Enregistrement…" : "Enregistrer le rapport"}
            </button>
          </form>
        </motion.div>
        ) : null}

        <div className="min-w-0 space-y-8">
          {canSeeCounterTreasury ? (
            <>
          <div>
            <h2 className="mb-3 font-display text-lg tracking-wide text-brand-cream/95">Ventes comptoir (synthèse)</h2>
            <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  <tr>
                    <th className="px-4 py-3">Jour</th>
                    <th className="px-4 py-3">Caisse</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Espèces</th>
                    <th className="px-4 py-3">Autres</th>
                    <th className="px-4 py-3">Lignes</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-white/45">
                        Chargement…
                      </td>
                    </tr>
                  ) : rollupSorted.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-white/45">
                        Aucune vente comptoir sur cette période.
                      </td>
                    </tr>
                  ) : (
                    rollupSorted.map((row, idx) => (
                      <tr key={`${row.pointOfSaleId ?? "na"}-${row.day}-${idx}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-4 py-3 whitespace-nowrap text-white/60">{row.day}</td>
                        <td className="px-4 py-3 text-white/55">{row.pointOfSaleLabel ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-brand-cream/90">
                          {row.totalCdf.toLocaleString("fr-CD")} FC
                        </td>
                        <td className="px-4 py-3 font-mono text-white/65">
                          {row.cashCdf.toLocaleString("fr-CD")} FC
                        </td>
                        <td className="px-4 py-3 font-mono text-white/50">
                          {row.nonCashCdf.toLocaleString("fr-CD")} FC
                        </td>
                        <td className="px-4 py-3 text-white/45">{row.saleCount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg tracking-wide text-brand-cream/95">Rapports déposés</h2>
            <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Caisse</th>
                    <th className="px-4 py-3">Fond</th>
                    <th className="px-4 py-3">Ventes esp. (syst.)</th>
                    <th className="px-4 py-3">Attendu</th>
                    <th className="px-4 py-3">Compté</th>
                    <th className="px-4 py-3">Écart</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Livre</th>
                    <th className="px-4 py-3">Par</th>
                    {canManageTreasury ? <th className="px-4 py-3 text-right">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={reportTableColSpan} className="px-4 py-10 text-center text-white/45">
                        Chargement…
                      </td>
                    </tr>
                  ) : reportsSorted.length === 0 ? (
                    <tr>
                      <td colSpan={reportTableColSpan} className="px-4 py-10 text-center text-white/45">
                        Aucun rapport sur cette période.
                      </td>
                    </tr>
                  ) : (
                    reportsSorted.map((r) => (
                      <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-4 py-3 whitespace-nowrap text-white/60">{r.reportDate}</td>
                        <td className="px-4 py-3 text-white/55">{r.pointOfSaleLabel ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-white/55">
                          {r.openingFloatCdf.toLocaleString("fr-CD")} FC
                        </td>
                        <td className="px-4 py-3 font-mono text-white/50">
                          {r.systemCashSalesCdf.toLocaleString("fr-CD")} FC
                        </td>
                        <td className="px-4 py-3 font-mono text-white/60">
                          {r.expectedCashCdf.toLocaleString("fr-CD")} FC
                        </td>
                        <td className="px-4 py-3 font-mono text-brand-cream/90">
                          {r.countedCashCdf.toLocaleString("fr-CD")} FC
                        </td>
                        <td className={`px-4 py-3 font-mono font-medium ${varianceClassAmount(r.varianceCdf, "CDF")}`}>
                          {r.varianceCdf > 0 ? "+" : ""}
                          {r.varianceCdf.toLocaleString("fr-CD")} FC
                        </td>
                        <td className="px-4 py-3 text-white/50">
                          {r.status === "validated" ? (
                            <span className="text-emerald-300/90">Validé</span>
                          ) : (
                            <span className="text-amber-200/85">Attente trésorerie</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-white/45">
                          {r.status === "validated" && r.cashBookMovementId ? (
                            <span className="text-emerald-200/80">Entrée enregistrée</span>
                          ) : r.status === "validated" ? (
                            <span className="text-white/35">0 FC (aucune entrée)</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-white/45">
                          {r.submittedByName ?? "—"}
                          {r.notesCashier ? (
                            <span className="mt-0.5 block text-[11px] text-white/35">{r.notesCashier}</span>
                          ) : null}
                          {r.status === "validated" && r.validatedByName ? (
                            <span className="mt-0.5 block text-[11px] text-white/30">
                              Validé par {r.validatedByName}
                              {r.notesTreasury ? ` — ${r.notesTreasury}` : ""}
                            </span>
                          ) : null}
                        </td>
                        {canManageTreasury ? (
                          <td className="px-4 py-3 text-right">
                            {r.status === "submitted" ? (
                              <button
                                type="button"
                                onClick={() => setValidateModal({ kind: "counter", report: r })}
                                className="text-xs font-semibold text-brand-orange/90 hover:underline"
                              >
                                Valider…
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-white/30">
              Attendu = fond d’ouverture + total des ventes comptoir en espèces enregistrées pour ce jour et cette caisse.
              La trésorerie enregistre au{" "}
              <Link to="/livre-caisse" className="text-brand-orange/80 hover:underline">
                livre de caisse
              </Link>{" "}
              un mouvement « entrée » (ajustement) sur le compte caisse central, pour le montant validé (par défaut :
              espèces comptées).
            </p>
          </div>
            </>
          ) : null}

          {canSeeReceptionTreasury ? (
          <div>
            <h2 className="mb-3 font-display text-lg tracking-wide text-brand-cream/95">
              Rapports caisse réception (USD)
            </h2>
            <p className="mb-3 text-xs text-white/40">
              Encaissements séjour et droits d’entrée visiteur en <strong className="text-white/55">espèces</strong>,
              consolidés par jour. Même principe que le comptoir : dépôt par la réception, validation trésorerie, puis
              entrée au livre de caisse en USD.
            </p>
            <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Fond</th>
                    <th className="px-4 py-3">Encaissements esp. (syst.)</th>
                    <th className="px-4 py-3">Attendu</th>
                    <th className="px-4 py-3">Compté</th>
                    <th className="px-4 py-3">Écart</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Livre</th>
                    <th className="px-4 py-3">Par</th>
                    {canManageTreasury ? <th className="px-4 py-3 text-right">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={receptionReportTableColSpan} className="px-4 py-10 text-center text-white/45">
                        Chargement…
                      </td>
                    </tr>
                  ) : receptionReportsSorted.length === 0 ? (
                    <tr>
                      <td colSpan={receptionReportTableColSpan} className="px-4 py-10 text-center text-white/45">
                        Aucun rapport réception sur cette période.
                      </td>
                    </tr>
                  ) : (
                    receptionReportsSorted.map((r) => (
                      <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-4 py-3 whitespace-nowrap text-white/60">{r.reportDate}</td>
                        <td className="px-4 py-3 font-mono text-white/55">
                          {r.openingFloatUsd.toLocaleString("fr-CD")} USD
                        </td>
                        <td className="px-4 py-3 font-mono text-white/50">
                          {r.systemCashSalesUsd.toLocaleString("fr-CD")} USD
                        </td>
                        <td className="px-4 py-3 font-mono text-white/60">
                          {r.expectedCashUsd.toLocaleString("fr-CD")} USD
                        </td>
                        <td className="px-4 py-3 font-mono text-brand-cream/90">
                          {r.countedCashUsd.toLocaleString("fr-CD")} USD
                        </td>
                        <td className={`px-4 py-3 font-mono font-medium ${varianceClassAmount(r.varianceUsd, "USD")}`}>
                          {r.varianceUsd > 0 ? "+" : ""}
                          {r.varianceUsd.toLocaleString("fr-CD")} USD
                        </td>
                        <td className="px-4 py-3 text-white/50">
                          {r.status === "validated" ? (
                            <span className="text-emerald-300/90">Validé</span>
                          ) : (
                            <span className="text-amber-200/85">Attente trésorerie</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-white/45">
                          {r.status === "validated" && r.cashBookMovementId ? (
                            <span className="text-emerald-200/80">Entrée enregistrée</span>
                          ) : r.status === "validated" ? (
                            <span className="text-white/35">0 USD (aucune entrée)</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-white/45">
                          {r.submittedByName ?? "—"}
                          {r.notesCashier ? (
                            <span className="mt-0.5 block text-[11px] text-white/35">{r.notesCashier}</span>
                          ) : null}
                          {r.status === "validated" && r.validatedByName ? (
                            <span className="mt-0.5 block text-[11px] text-white/30">
                              Validé par {r.validatedByName}
                              {r.notesTreasury ? ` — ${r.notesTreasury}` : ""}
                            </span>
                          ) : null}
                        </td>
                        {canManageTreasury ? (
                          <td className="px-4 py-3 text-right">
                            {r.status === "submitted" ? (
                              <button
                                type="button"
                                onClick={() => setValidateModal({ kind: "reception", report: r })}
                                className="text-xs font-semibold text-brand-orange/90 hover:underline"
                              >
                                Valider…
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-white/30">
              Attendu = fond d’ouverture + total des paiements réservation en espèces + droits d’entrée visiteur en
              espèces enregistrés par vous pour cette date (système).
            </p>
          </div>
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {validateModal ? (
          <motion.div
            key="validate-modal"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tresorerie-validate-title"
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-zinc-950 p-6 shadow-xl"
            >
              <h3 id="tresorerie-validate-title" className="font-display text-lg tracking-wide text-brand-cream/95">
                Valider le rapport de caisse
              </h3>
              <p className="mt-2 text-xs text-white/45">
                {validateModal.kind === "counter" ? (
                  <>
                    {validateModal.report.pointOfSaleLabel ?? "Caisse"} · {validateModal.report.reportDate}. Vérifiez les
                    montants puis enregistrez une <strong className="text-white/60">entrée</strong> (ajustement) dans le
                    livre de caisse.
                  </>
                ) : (
                  <>
                    Caisse réception (USD) · {validateModal.report.reportDate}. Vérifiez les montants puis enregistrez
                    une <strong className="text-white/60">entrée</strong> (ajustement) dans le livre de caisse.
                  </>
                )}
              </p>
              <form onSubmit={submitValidateReport} className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor="tresorerie-validate-montant"
                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40"
                  >
                    Montant à comptabiliser ({validateModal.kind === "counter" ? "CDF" : "USD"})
                  </label>
                  <input
                    id="tresorerie-validate-montant"
                    type="text"
                    inputMode="numeric"
                    value={validateAmountStr}
                    onChange={(e) => setValidateAmountStr(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  />
                  <p className="mt-1 text-[10px] text-white/35">
                    Par défaut : espèces comptées (
                    {validateModal.kind === "counter"
                      ? `${validateModal.report.countedCashCdf.toLocaleString("fr-CD")} FC`
                      : `${validateModal.report.countedCashUsd.toLocaleString("fr-CD")} USD`}
                    ). Mettez 0 pour valider sans mouvement au livre.
                  </p>
                </div>
                {Number(validateAmountStr.replace(/\s/g, "").replace(",", ".") || 0) > 0 ? (
                  <div>
                    <label
                      htmlFor="tresorerie-validate-compte"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40"
                    >
                      Compte caisse central ({validateModal.kind === "counter" ? "CDF" : "USD"})
                    </label>
                    <select
                      id="tresorerie-validate-compte"
                      value={validateAccountId}
                      onChange={(e) => setValidateAccountId(e.target.value)}
                      disabled={remittanceAccounts.length === 0}
                      className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
                    >
                      {remittanceAccounts.length === 0 ? (
                        <option value="">Aucun compte — créez-en dans le livre de caisse</option>
                      ) : (
                        remittanceAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label} ({a.code})
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                ) : null}
                <div>
                  <label
                    htmlFor="tresorerie-validate-note"
                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40"
                  >
                    Note trésorerie (optionnel)
                  </label>
                  <textarea
                    id="tresorerie-validate-note"
                    rows={2}
                    value={validateNote}
                    onChange={(e) => setValidateNote(e.target.value)}
                    className="w-full resize-none rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    placeholder="Ex. contrôle OK, remise coffre…"
                  />
                </div>
                {validateErr ? (
                  <p className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95">
                    {validateErr}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={validateBusy}
                    className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {validateBusy ? "Validation…" : "Valider et comptabiliser"}
                  </button>
                  <button
                    type="button"
                    disabled={validateBusy}
                    onClick={() => setValidateModal(null)}
                    className="rounded-xl border border-white/15 px-4 py-2 text-xs text-white/70 hover:bg-white/10"
                  >
                    Annuler
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

          </div>
        </>
      ) : null}

      {canManageTreasury && treasuryTab === "caisses" ? (
        <motion.section
          id="tresorerie-panel-caisses"
          role="tabpanel"
          aria-labelledby="tresorerie-tab-caisses"
          className="mb-8 rounded-2xl border border-white/10 glass-panel p-6"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-orange/25 bg-brand-orange/10 text-brand-cream">
              <Store className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg tracking-wide text-brand-cream/95">Caisses (points de vente)</h2>
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/70 hover:bg-white/10"
                >
                  Actualiser la liste
                </button>
              </div>
              <p className="mt-1 text-xs text-white/40">
                Chaque caisse est liée à un lieu de consommation pour le stock. Le code doit être unique (ex. T2,
                BUVETTE). Une seule caisse peut être marquée comme <strong className="text-white/55">principale</strong>{" "}
                (défaut pour les ventes si aucun choix).
              </p>
              {treasuryPointsLoadFailed ? (
                <p className="mt-2 text-xs text-amber-200/85">
                  Impossible de charger la liste des caisses. Utilisez « Synthèse & rapports » puis « Actualiser », ou
                  reconnectez-vous.
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid gap-8 lg:grid-cols-2">
            <form onSubmit={submitCreateCaisse} className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">Nouvelle caisse</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    Code
                  </label>
                  <input
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    placeholder="ex. T2"
                    maxLength={64}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    Libellé
                  </label>
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    placeholder="ex. Terrasse 2"
                    maxLength={200}
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-white/55">
                <input
                  type="checkbox"
                  checked={newIsMain}
                  onChange={(e) => setNewIsMain(e.target.checked)}
                  className="rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                />
                Définir comme caisse principale
              </label>
              {createErr ? (
                <p className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95">
                  {createErr}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={createBusy || apiError}
                className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/85 hover:bg-white/10 disabled:opacity-40"
              >
                {createBusy ? "Création…" : "Créer la caisse"}
              </button>
            </form>

            {editing ? (
              <form onSubmit={submitEditCaisse} className="space-y-3 rounded-xl border border-brand-orange/25 bg-black/20 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">Modifier la caisse</h3>
                <p className="text-[11px] text-white/35">
                  <span className="font-mono text-white/50">{editing.id}</span> · lieu stock :{" "}
                  {editing.stockLocationLabel}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                      Code
                    </label>
                    <input
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value)}
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                      maxLength={64}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                      Ordre
                    </label>
                    <input
                      value={editSortStr}
                      onChange={(e) => setEditSortStr(e.target.value)}
                      inputMode="numeric"
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    Libellé
                  </label>
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    maxLength={200}
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-white/55">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                    className="rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                  />
                  Caisse active (visible au comptoir et pour les rapports)
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-white/55">
                  <input
                    type="checkbox"
                    checked={editIsMain}
                    onChange={(e) => setEditIsMain(e.target.checked)}
                    className="rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                  />
                  Caisse principale
                </label>
                {editErr ? (
                  <p className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95">
                    {editErr}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={editBusy || apiError}
                    className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {editBusy ? "Enregistrement…" : "Enregistrer"}
                  </button>
                  <button
                    type="button"
                    disabled={editBusy}
                    onClick={() => setEditing(null)}
                    className="rounded-xl border border-white/15 px-4 py-2 text-xs text-white/70 hover:bg-white/10"
                  >
                    Annuler
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/10 p-8 text-center text-xs text-white/40">
                Cliquez sur « Modifier » dans le tableau pour éditer une caisse.
              </div>
            )}
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Libellé</th>
                  <th className="px-4 py-3">Ordre</th>
                  <th className="px-4 py-3">Principale</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-white/45">
                      Chargement…
                    </td>
                  </tr>
                ) : treasuryPointsAll.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-white/45">
                      Aucune caisse. Créez-en une avec le formulaire ci-dessus.
                    </td>
                  </tr>
                ) : (
                  treasuryPointsAll.map((p) => (
                    <tr
                      key={p.id}
                      className={`border-b border-white/5 hover:bg-white/[0.02] ${editing?.id === p.id ? "bg-brand-orange/5" : ""}`}
                    >
                      <td className="px-4 py-3 font-mono text-white/70">{p.code}</td>
                      <td className="px-4 py-3 text-white/55">{p.label}</td>
                      <td className="px-4 py-3 font-mono text-white/45">{p.sortOrder}</td>
                      <td className="px-4 py-3">{p.isMain ? <span className="text-emerald-300/90">Oui</span> : "—"}</td>
                      <td className="px-4 py-3">
                        {p.active ? (
                          <span className="text-white/60">Oui</span>
                        ) : (
                          <span className="text-amber-200/80">Non</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          className="text-xs font-semibold text-brand-orange/90 hover:underline"
                        >
                          Modifier
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </motion.section>
      ) : null}
    </div>
  );
}
