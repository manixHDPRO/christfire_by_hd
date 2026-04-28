import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { visitorEntryAdultUsdSeed, visitorEntryMinorUsdSeed } from "@/data/mock";
import {
  clientProfileHint,
  clientProfileLabel,
  displayClientEmail,
  isProfileEmailOptional,
  profileAppliesEntryFee,
  profileBadgeClass,
  suggestedEntryFeeUsdString,
} from "@/lib/clientProfile";
import { visitorFamilyGroupEntryUsd } from "@/lib/visitorEntryPricing";
import { visitorVisitShortLabel } from "@/lib/visitorVisitDisplay";
import {
  apiCreateClient,
  apiGetVisitorEntryPrice,
  apiListClients,
  apiListClientProfileTypes,
  apiListReservations,
  apiUpdateClient,
  type UpdateClientInput,
} from "@/lib/api";
import { normalizeReservationFromApi } from "@/lib/reservationBungalows";
import type { Client, ClientProfileType, Reservation, VisitorVisitKind } from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarPlus, Plus, Ticket, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

function profileOrDefault(c: Client): string {
  return c.clientProfile ?? "hebergement";
}

function visitClientErrorMessage(code: string): string {
  switch (code) {
    case "validation_error":
      return "Vérifiez la composition et le droit d’entrée.";
    case "forbidden":
      return "Vous n’avez pas les droits pour modifier les clients.";
    case "not_found":
      return "Client introuvable.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "L’enregistrement a échoué. Réessayez.";
  }
}

function createClientErrorMessage(code: string): string {
  switch (code) {
    case "email_taken":
      return "Cet e-mail est déjà enregistré pour un client.";
    case "validation_error":
      return "Vérifiez les champs obligatoires, l’e-mail et le droit d’entrée ($) pour les profils visiteurs.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "L’enregistrement a échoué. Réessayez.";
  }
}

export function Clients() {
  const navigate = useNavigate();
  const baseId = useId();
  const [list, setList] = useState<Client[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [nvName, setNvName] = useState("");
  const [nvEmail, setNvEmail] = useState("");
  const [nvPhone, setNvPhone] = useState("");
  const [nvNotes, setNvNotes] = useState("");
  const [nvProfile, setNvProfile] = useState("hebergement");
  const [nvEntryFeeUsd, setNvEntryFeeUsd] = useState("");
  const [nvVisitKind, setNvVisitKind] = useState<"" | VisitorVisitKind>("");
  const [nvAdults, setNvAdults] = useState("");
  const [nvMinors, setNvMinors] = useState("");
  const [visitorAdultUsd, setVisitorAdultUsd] = useState(visitorEntryAdultUsdSeed);
  const [visitorMinorUsd, setVisitorMinorUsd] = useState(visitorEntryMinorUsdSeed);
  const [profileFilter, setProfileFilter] = useState<"all" | string>("all");
  const [profileTypes, setProfileTypes] = useState<ClientProfileType[]>([]);

  const [visitClient, setVisitClient] = useState<Client | null>(null);
  const [visitKind, setVisitKind] = useState<"" | VisitorVisitKind>("");
  const [visitAdults, setVisitAdults] = useState("");
  const [visitMinors, setVisitMinors] = useState("");
  const [visitEntryUsd, setVisitEntryUsd] = useState("");
  const [visitNote, setVisitNote] = useState("");
  const [visitBusy, setVisitBusy] = useState(false);
  const [visitErr, setVisitErr] = useState<string | null>(null);

  const filteredClients = useMemo(() => {
    if (profileFilter === "all") return list;
    return list.filter((c) => profileOrDefault(c) === profileFilter);
  }, [list, profileFilter]);

  const reload = useCallback(async () => {
    setLoading(true);
    const [c, res] = await Promise.all([apiListClients(), apiListReservations()]);
    if (c === null) {
      setApiError(true);
      setList([]);
      setReservations([]);
    } else {
      setApiError(false);
      setList(c);
      if (res === null) {
        setReservations([]);
      } else {
        setReservations(
          res.map((r) =>
            normalizeReservationFromApi({
              ...r,
              amountPaid: r.amountPaid ?? 0,
              latePenaltyUsd: r.latePenaltyUsd ?? 0,
            }),
          ),
        );
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [rows, ve] = await Promise.all([apiListClientProfileTypes(), apiGetVisitorEntryPrice()]);
      if (cancelled) return;
      if (ve) {
        setVisitorAdultUsd(ve.adultPriceUsd);
        setVisitorMinorUsd(ve.minorPriceUsd);
      }
      if (rows !== null && rows.length > 0) {
        setProfileTypes(rows);
        setNvProfile((prev) => (rows.some((r) => r.code === prev) ? prev : rows[0]!.code));
      } else {
        setProfileTypes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!profileAppliesEntryFee(nvProfile, profileTypes)) return;
    if (!nvVisitKind) {
      setNvEntryFeeUsd(suggestedEntryFeeUsdString(nvProfile, profileTypes, visitorAdultUsd));
      return;
    }
    if (nvVisitKind === "individual") {
      setNvEntryFeeUsd(String(Math.max(1, visitorAdultUsd)));
      return;
    }
    const ad = nvAdults.trim() === "" ? 0 : Number.parseInt(nvAdults.trim(), 10);
    const mi = nvMinors.trim() === "" ? 0 : Number.parseInt(nvMinors.trim(), 10);
    if (!Number.isFinite(ad) || !Number.isFinite(mi) || ad < 0 || mi < 0 || ad + mi < 1) return;
    setNvEntryFeeUsd(String(visitorFamilyGroupEntryUsd(ad, mi, visitorAdultUsd, visitorMinorUsd)));
  }, [nvProfile, profileTypes, nvVisitKind, nvAdults, nvMinors, visitorAdultUsd, visitorMinorUsd]);

  useEffect(() => {
    if (!profileAppliesEntryFee(nvProfile, profileTypes)) {
      setNvVisitKind("");
      setNvAdults("");
      setNvMinors("");
    }
  }, [nvProfile, profileTypes]);

  useEffect(() => {
    if (!visitClient) return;
    const prof = profileOrDefault(visitClient);
    if (!profileAppliesEntryFee(prof, profileTypes)) return;
    if (!visitKind) {
      setVisitEntryUsd(suggestedEntryFeeUsdString(prof, profileTypes, visitorAdultUsd));
      return;
    }
    if (visitKind === "individual") {
      return;
    }
    const ad = visitAdults.trim() === "" ? 0 : Number.parseInt(visitAdults.trim(), 10);
    const mi = visitMinors.trim() === "" ? 0 : Number.parseInt(visitMinors.trim(), 10);
    if (!Number.isFinite(ad) || !Number.isFinite(mi) || ad < 0 || mi < 0 || ad + mi < 1) return;
    setVisitEntryUsd(String(visitorFamilyGroupEntryUsd(ad, mi, visitorAdultUsd, visitorMinorUsd)));
  }, [visitClient, visitKind, visitAdults, visitMinors, visitorAdultUsd, visitorMinorUsd, profileTypes]);

  const openVisitForClient = useCallback(
    (c: Client) => {
      setVisitErr(null);
      setVisitNote("");
      setVisitClient(c);
      const k = c.visitorVisitKind;
      if (k === "individual" || k === "group" || k === "family") {
        setVisitKind(k);
        if (k === "individual") {
          setVisitAdults("");
          setVisitMinors("");
          setVisitEntryUsd(String(Math.max(1, c.entryFeeUsd ?? visitorAdultUsd)));
        } else {
          setVisitAdults(c.visitorAdultsCount != null ? String(c.visitorAdultsCount) : "");
          setVisitMinors(c.visitorMinorsCount != null ? String(c.visitorMinorsCount) : "");
        }
      } else {
        setVisitKind("");
        setVisitAdults("");
        setVisitMinors("");
      }
    },
    [visitorAdultUsd],
  );

  const closeVisitModal = useCallback(() => {
    if (visitBusy) return;
    setVisitClient(null);
    setVisitErr(null);
  }, [visitBusy]);

  const submitVisit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!visitClient) return;
      setVisitErr(null);
      const prof = profileOrDefault(visitClient);
      if (!profileAppliesEntryFee(prof, profileTypes)) {
        setVisitErr("Ce profil ne gère pas les visites avec droit d’entrée.");
        return;
      }
      if (!visitKind) {
        setVisitErr("Indiquez si la visite est individuelle, en groupe ou en famille.");
        return;
      }
      const payload: UpdateClientInput = {};
      if (visitNote.trim()) {
        const stamp = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
        const block = `— Visite (${stamp}) : ${visitNote.trim()}`;
        payload.notes = visitClient.notes.trim() ? `${visitClient.notes.trim()}\n\n${block}` : block;
      }
      if (visitKind === "individual") {
        const feeNum = visitEntryUsd.trim() === "" ? NaN : Number(visitEntryUsd);
        if (!Number.isFinite(feeNum) || feeNum < 1) {
          setVisitErr("Indiquez le droit d’entrée en dollars US (entier ≥ 1).");
          return;
        }
        payload.visitorVisitKind = "individual";
        payload.entryFeeUsd = feeNum;
      } else {
        const ad = visitAdults.trim() === "" ? NaN : Number.parseInt(visitAdults.trim(), 10);
        const mi = visitMinors.trim() === "" ? NaN : Number.parseInt(visitMinors.trim(), 10);
        if (!Number.isFinite(ad) || !Number.isFinite(mi) || ad < 0 || mi < 0 || ad + mi < 1) {
          setVisitErr("Indiquez le nombre d’adultes et de mineurs (au moins une personne au total).");
          return;
        }
        payload.visitorVisitKind = visitKind;
        payload.visitorAdultsCount = ad;
        payload.visitorMinorsCount = mi;
      }
      setVisitBusy(true);
      const res = await apiUpdateClient(visitClient.id, payload);
      setVisitBusy(false);
      if (res.ok) {
        setList((prev) => prev.map((x) => (x.id === res.client.id ? res.client : x)).sort((a, b) => a.name.localeCompare(b.name, "fr")));
        setVisitClient(null);
        return;
      }
      setVisitErr(visitClientErrorMessage(res.code));
    },
    [visitAdults, visitClient, visitEntryUsd, visitKind, visitMinors, visitNote, profileTypes],
  );

  const openCreate = useCallback(() => {
    setCreateErr(null);
    setNvName("");
    setNvEmail("");
    setNvPhone("");
    setNvNotes("");
    setNvVisitKind("");
    setNvAdults("");
    setNvMinors("");
    setNvProfile(profileTypes[0]?.code ?? "hebergement");
    setCreateOpen(true);
  }, [profileTypes]);

  const submitCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setCreateErr(null);
      const feeNum = nvEntryFeeUsd.trim() === "" ? 0 : Number(nvEntryFeeUsd);
      if (profileAppliesEntryFee(nvProfile, profileTypes)) {
        if (!Number.isFinite(feeNum) || feeNum < 1) {
          setCreateErr("Indiquez le droit d’entrée en dollars US (entier ≥ 1) pour ce profil visiteur.");
          return;
        }
      }
      let visitorVisitKind: VisitorVisitKind | undefined;
      let visitorAdultsCount: number | undefined;
      let visitorMinorsCount: number | undefined;
      if (profileAppliesEntryFee(nvProfile, profileTypes)) {
        if (!nvVisitKind) {
          setCreateErr("Indiquez si le passage est individuel, en groupe ou en famille.");
          return;
        }
        visitorVisitKind = nvVisitKind;
        if (nvVisitKind === "group" || nvVisitKind === "family") {
          const ad = nvAdults.trim() === "" ? NaN : Number.parseInt(nvAdults.trim(), 10);
          const mi = nvMinors.trim() === "" ? NaN : Number.parseInt(nvMinors.trim(), 10);
          if (!Number.isFinite(ad) || !Number.isFinite(mi) || ad < 0 || mi < 0 || ad + mi < 1) {
            setCreateErr("Indiquez le nombre d’adultes et de mineurs (au moins une personne au total).");
            return;
          }
          visitorAdultsCount = ad;
          visitorMinorsCount = mi;
        }
      }
      setCreateBusy(true);
      const res = await apiCreateClient({
        name: nvName,
        email: isProfileEmailOptional(nvProfile, profileTypes) ? nvEmail.trim() || undefined : nvEmail.trim(),
        phone: nvPhone,
        notes: nvNotes,
        clientProfile: nvProfile,
        ...(profileAppliesEntryFee(nvProfile, profileTypes) && visitorVisitKind
          ? {
              entryFeeUsd: feeNum,
              visitorVisitKind,
              ...(visitorVisitKind === "group" || visitorVisitKind === "family"
                ? { visitorAdultsCount: visitorAdultsCount!, visitorMinorsCount: visitorMinorsCount! }
                : {}),
            }
          : {}),
      });
      setCreateBusy(false);
      if (res.ok) {
        setCreateOpen(false);
        setList((prev) => [...prev, res.client].sort((a, b) => a.name.localeCompare(b.name, "fr")));
        navigate(`/clients/${res.client.id}`);
        return;
      }
      setCreateErr(createClientErrorMessage(res.code));
    },
    [
      navigate,
      nvAdults,
      nvEmail,
      nvEntryFeeUsd,
      nvMinors,
      nvName,
      nvNotes,
      nvPhone,
      nvProfile,
      nvVisitKind,
      profileTypes,
    ],
  );

  return (
    <div>
      <Breadcrumb items={[{ label: "Clients" }]} />
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-white">Clients</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {["all", ...profileTypes.map((p) => p.code)].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setProfileFilter(key)}
                className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                  profileFilter === key
                    ? "border-brand-orange/40 bg-brand-orange/15 text-brand-cream"
                    : "border-white/10 text-white/45 hover:border-white/20 hover:text-white/70"
                }`}
              >
                {key === "all" ? "Tous" : clientProfileLabel(key, profileTypes)}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={loading || apiError}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-orange/40 bg-brand-orange/15 px-4 py-2.5 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-orange/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          Nouveau client
        </button>
      </header>

      {apiError && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
          Impossible de charger les clients depuis l’API. Vérifiez que le serveur tourne et que vous êtes connecté.
          <button
            type="button"
            onClick={() => void reload()}
            className="ml-3 underline underline-offset-2 hover:text-white"
          >
            Réessayer
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">Profil</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3 text-right">Entrée ($)</th>
              <th className="px-4 py-3 text-right">Réservations</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-white/45">
                  Chargement…
                </td>
              </tr>
            ) : apiError ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-white/40">
                  —
                </td>
              </tr>
            ) : filteredClients.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-white/45">
                  {list.length === 0
                    ? "Aucun client. Utilisez « Nouveau client » pour en ajouter un en base."
                    : "Aucun client pour ce filtre."}
                </td>
              </tr>
            ) : (
              filteredClients.map((c, i) => {
                const n = reservations.filter((r) => r.clientId === c.id).length;
                const prof = profileOrDefault(c);
                const profLabel = clientProfileLabel(prof, profileTypes);
                return (
                  <motion.tr
                    key={c.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="cursor-pointer border-b border-white/5 hover:bg-white/[0.02]"
                    onClick={() => navigate(`/clients/${c.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/clients/${c.id}`);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Ouvrir la fiche ${c.name}`}
                  >
                    <td className="px-4 py-4 font-medium text-white/90">{c.name}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${profileBadgeClass(prof)}`}
                      >
                        {profLabel}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-white/50">
                      <div>{displayClientEmail(c.email)}</div>
                      <div className="text-xs text-white/35">{c.phone || "—"}</div>
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums text-white/55">
                      {profileAppliesEntryFee(prof, profileTypes) ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-brand-cream/85">{(c.entryFeeUsd ?? 0).toLocaleString("fr-FR")} $</span>
                          {visitorVisitShortLabel(c) ? (
                            <span className="max-w-[10rem] text-right text-[10px] font-normal normal-case text-white/40">
                              {visitorVisitShortLabel(c)}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-4 text-right text-brand-cream/80">{n}</td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end">
                        {profileAppliesEntryFee(prof, profileTypes) ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openVisitForClient(c);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/35 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-100/95 transition-colors hover:bg-sky-500/20"
                          >
                            <Ticket className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Visite
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/reservations?nouveau=1&clientId=${encodeURIComponent(c.id)}`);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-orange/35 bg-brand-orange/10 px-3 py-1.5 text-xs font-medium text-brand-cream/95 transition-colors hover:bg-brand-orange/20"
                        >
                          <CalendarPlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          Réserver
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {createOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            role="presentation"
            onClick={() => {
              if (!createBusy) setCreateOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${baseId}-new-client-title`}
              className="glass-panel w-full max-w-md rounded-2xl border border-white/10 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <h2 id={`${baseId}-new-client-title`} className="font-display text-lg tracking-wide text-brand-cream/95">
                  Nouveau client
                </h2>
                <button
                  type="button"
                  disabled={createBusy}
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {createErr && (
                <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100/90">
                  {createErr}
                </div>
              )}
              <form onSubmit={submitCreate} className="space-y-3">
                <div>
                  <label htmlFor={`${baseId}-cl-profile`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    Profil
                  </label>
                  <select
                    id={`${baseId}-cl-profile`}
                    value={nvProfile}
                    onChange={(e) => setNvProfile(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                  >
                    {profileTypes.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-white/35">{clientProfileHint(nvProfile, profileTypes)}</p>
                </div>
                {profileAppliesEntryFee(nvProfile, profileTypes) ? (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-black/15 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-white/45">Composition du passage</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {(
                        [
                          ["individual", "Individuel"],
                          ["group", "En groupe"],
                          ["family", "En famille"],
                        ] as const
                      ).map(([code, label]) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => {
                            setNvVisitKind(code);
                            if (code === "individual") {
                              setNvAdults("");
                              setNvMinors("");
                            }
                          }}
                          className={`rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors ${
                            nvVisitKind === code
                              ? "border-sky-400/50 bg-sky-500/15 text-sky-100"
                              : "border-white/15 bg-black/25 text-white/65 hover:border-white/25 hover:bg-white/[0.06]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {(nvVisitKind === "group" || nvVisitKind === "family") && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor={`${baseId}-cl-adults`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                            Adultes
                          </label>
                          <input
                            id={`${baseId}-cl-adults`}
                            type="number"
                            min={0}
                            max={999}
                            step={1}
                            value={nvAdults}
                            onChange={(e) => setNvAdults(e.target.value)}
                            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                            placeholder="0"
                          />
                        </div>
                        <div>
                          <label htmlFor={`${baseId}-cl-minors`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                            Mineurs
                          </label>
                          <input
                            id={`${baseId}-cl-minors`}
                            type="number"
                            min={0}
                            max={999}
                            step={1}
                            value={nvMinors}
                            onChange={(e) => setNvMinors(e.target.value)}
                            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    )}
                    {nvVisitKind === "" ? (
                      <p className="text-[10px] text-white/40">Choisissez une option ci-dessus pour afficher le nom, l’e-mail et le téléphone.</p>
                    ) : null}
                    <div>
                      <label htmlFor={`${baseId}-cl-entry`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Droit d’entrée ($)
                      </label>
                      <input
                        id={`${baseId}-cl-entry`}
                        type="number"
                        min={1}
                        step={1}
                        required
                        value={nvEntryFeeUsd}
                        onChange={(e) => setNvEntryFeeUsd(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/30 focus:ring-2"
                        placeholder="Total à encaisser pour cette fiche"
                      />
                      <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                        Montant total dû (une fiche = une unité d’encaissement). Tarif par personne : calculez le total puis saisissez-le ici.
                      </p>
                    </div>
                  </div>
                ) : null}
                {(!profileAppliesEntryFee(nvProfile, profileTypes) || nvVisitKind !== "") && (
                  <>
                    <div>
                      <label htmlFor={`${baseId}-cl-name`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        {profileAppliesEntryFee(nvProfile, profileTypes)
                          ? nvVisitKind === "individual"
                            ? "Nom"
                            : "Nom du responsable"
                          : "Nom complet"}
                      </label>
                      <input
                        id={`${baseId}-cl-name`}
                        required
                        value={nvName}
                        onChange={(e) => setNvName(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/30 focus:ring-2"
                        placeholder={
                          profileAppliesEntryFee(nvProfile, profileTypes)
                            ? nvVisitKind === "individual"
                              ? "Prénom et nom"
                              : "Responsable du groupe ou de la famille"
                            : "Jean Dupont"
                        }
                        autoComplete="name"
                      />
                    </div>
                    <div>
                      <label htmlFor={`${baseId}-cl-email`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        E-mail
                        {isProfileEmailOptional(nvProfile, profileTypes) ? " (facultatif)" : ""}
                        {profileAppliesEntryFee(nvProfile, profileTypes) && nvVisitKind !== "individual" ? " — responsable" : ""}
                      </label>
                      <input
                        id={`${baseId}-cl-email`}
                        type="email"
                        required={!isProfileEmailOptional(nvProfile, profileTypes)}
                        value={nvEmail}
                        onChange={(e) => setNvEmail(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/30 focus:ring-2"
                        placeholder={
                          isProfileEmailOptional(nvProfile, profileTypes) ? "Laisser vide si inconnu" : "contact@exemple.fr"
                        }
                        autoComplete="email"
                      />
                    </div>
                    <div>
                      <label htmlFor={`${baseId}-cl-phone`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Téléphone
                        {profileAppliesEntryFee(nvProfile, profileTypes) && nvVisitKind !== "individual" ? " — responsable" : ""}
                      </label>
                      <input
                        id={`${baseId}-cl-phone`}
                        value={nvPhone}
                        onChange={(e) => setNvPhone(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/30 focus:ring-2"
                        placeholder="+243 …"
                        autoComplete="tel"
                      />
                    </div>
                  </>
                )}
                <div>
                  <label htmlFor={`${baseId}-cl-notes`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    Notes internes
                  </label>
                  <textarea
                    id={`${baseId}-cl-notes`}
                    rows={3}
                    value={nvNotes}
                    onChange={(e) => setNvNotes(e.target.value)}
                    className="w-full resize-none rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/30 focus:ring-2"
                    placeholder="Préférences, facturation…"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={createBusy}
                    onClick={() => setCreateOpen(false)}
                    className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={createBusy}
                    className="rounded-lg border border-brand-orange/40 bg-brand-orange/20 px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-orange/30 disabled:opacity-40"
                  >
                    {createBusy ? "Enregistrement…" : "Enregistrer"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visitClient ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            role="presentation"
            onClick={() => closeVisitModal()}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${baseId}-visit-title`}
              className="glass-panel max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 id={`${baseId}-visit-title`} className="font-display text-lg tracking-wide text-brand-cream/95">
                    Visite
                  </h2>
                  <p className="mt-1 text-xs text-white/45">
                    {visitClient.name}
                    <span className="text-white/30"> · </span>
                    {clientProfileLabel(profileOrDefault(visitClient), profileTypes)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={visitBusy}
                  onClick={() => closeVisitModal()}
                  className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mb-4 text-[11px] leading-relaxed text-white/50">
                Enregistrez la composition de <span className="font-medium text-white/70">cette visite</span> et le droit
                d’entrée dû. La fiche client est mise à jour (pas de doublon).
              </p>
              {visitErr ? (
                <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100/90" role="alert">
                  {visitErr}
                </div>
              ) : null}
              <form onSubmit={(e) => void submitVisit(e)} className="space-y-3">
                <div className="space-y-3 rounded-xl border border-white/10 bg-black/15 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-white/45">Composition</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(
                      [
                        ["individual", "Individuel"],
                        ["group", "En groupe"],
                        ["family", "En famille"],
                      ] as const
                    ).map(([code, label]) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => {
                          setVisitKind(code);
                          if (code === "individual") {
                            setVisitAdults("");
                            setVisitMinors("");
                            setVisitEntryUsd(String(Math.max(1, visitorAdultUsd)));
                          }
                        }}
                        className={`rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors ${
                          visitKind === code
                            ? "border-sky-400/50 bg-sky-500/15 text-sky-100"
                            : "border-white/15 bg-black/25 text-white/65 hover:border-white/25 hover:bg-white/[0.06]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {(visitKind === "group" || visitKind === "family") && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={`${baseId}-visit-adults`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                          Adultes
                        </label>
                        <input
                          id={`${baseId}-visit-adults`}
                          type="number"
                          min={0}
                          max={999}
                          step={1}
                          value={visitAdults}
                          onChange={(e) => setVisitAdults(e.target.value)}
                          className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label htmlFor={`${baseId}-visit-minors`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                          Mineurs
                        </label>
                        <input
                          id={`${baseId}-visit-minors`}
                          type="number"
                          min={0}
                          max={999}
                          step={1}
                          value={visitMinors}
                          onChange={(e) => setVisitMinors(e.target.value)}
                          className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  )}
                  {visitKind === "individual" ? (
                    <div>
                      <label htmlFor={`${baseId}-visit-entry`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Droit d’entrée ($)
                      </label>
                      <input
                        id={`${baseId}-visit-entry`}
                        type="number"
                        min={1}
                        step={1}
                        required
                        value={visitEntryUsd}
                        onChange={(e) => setVisitEntryUsd(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                      />
                      <p className="mt-1 text-[10px] text-white/35">Ajustez si besoin (tarif adulte par défaut depuis Paramètres).</p>
                    </div>
                  ) : visitKind === "group" || visitKind === "family" ? (
                    <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Total dû (calculé)</p>
                      <p className="mt-1 font-mono text-sm tabular-nums text-brand-cream/90">
                        {visitEntryUsd ? `${Number(visitEntryUsd).toLocaleString("fr-FR")} $` : "—"}
                      </p>
                      <p className="mt-1 text-[10px] text-white/35">Enregistrement : adultes × tarif adulte + mineurs × tarif mineur.</p>
                    </div>
                  ) : (
                    <p className="text-[10px] text-white/40">Choisissez une option ci-dessus.</p>
                  )}
                </div>
                <div>
                  <label htmlFor={`${baseId}-visit-note`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    Note pour cette visite (facultatif)
                  </label>
                  <textarea
                    id={`${baseId}-visit-note`}
                    rows={2}
                    value={visitNote}
                    onChange={(e) => setVisitNote(e.target.value)}
                    className="w-full resize-none rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                    placeholder="Ex. buvette, événement, remise accordée…"
                  />
                  <p className="mt-1 text-[10px] text-white/35">Ajoutée en bas des notes internes avec la date.</p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={visitBusy}
                    onClick={() => closeVisitModal()}
                    className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={visitBusy || !visitKind}
                    className="rounded-lg border border-sky-400/40 bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-100 transition-colors hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {visitBusy ? "Enregistrement…" : "Enregistrer la visite"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
