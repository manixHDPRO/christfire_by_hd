import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  apiCreateMaintenanceTicket,
  apiGetMaintenanceTicket,
  apiListBungalows,
  apiListMaintenanceTickets,
  apiMaintenanceAttachmentFileUrl,
  apiPatchMaintenanceTicket,
  apiPostMaintenanceTicketAttachment,
  apiPostMaintenanceTicketComment,
} from "@/lib/api";
import type {
  Bungalow,
  MaintenanceTicket,
  MaintenanceTicketAttachment,
  MaintenanceTicketCategory,
  MaintenanceTicketEvent,
  MaintenanceTicketPriority,
  MaintenanceTicketStatus,
} from "@/types";
import { motion } from "framer-motion";
import { FileText, Filter, MessageSquarePlus, Paperclip, Plus, Search, Wrench } from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const CAT_LABEL: Record<MaintenanceTicketCategory, string> = {
  panne: "Panne / équipement",
  clim: "Climatisation",
  plomberie: "Plomberie",
  electricite: "Électricité",
  autre: "Autre",
};

const PRI_LABEL: Record<MaintenanceTicketPriority, string> = {
  basse: "Basse",
  normale: "Normale",
  haute: "Haute",
  urgente: "Urgente",
};

const ST_LABEL: Record<MaintenanceTicketStatus, string> = {
  ouvert: "Ouvert",
  en_cours: "En cours",
  resolu: "Résolu",
  annule: "Annulé",
};

const ALL = "" as const;

function priorityClass(p: MaintenanceTicketPriority): string {
  switch (p) {
    case "basse":
      return "border-white/20 bg-white/5 text-white/65";
    case "normale":
      return "border-sky-400/35 bg-sky-500/15 text-sky-100";
    case "haute":
      return "border-amber-400/40 bg-amber-500/20 text-amber-100";
    case "urgente":
      return "border-red-400/45 bg-red-500/20 text-red-100";
  }
}

function statusClass(s: MaintenanceTicketStatus): string {
  switch (s) {
    case "ouvert":
      return "border-brand-orange/40 bg-brand-orange/15 text-brand-cream";
    case "en_cours":
      return "border-sky-400/35 bg-sky-500/15 text-sky-100";
    case "resolu":
      return "border-emerald-400/35 bg-emerald-500/15 text-emerald-100";
    case "annule":
      return "border-white/15 bg-white/5 text-white/45";
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

function eventKindLabel(k: MaintenanceTicketEvent["kind"]): string {
  switch (k) {
    case "created":
      return "Création";
    case "comment":
      return "Commentaire";
    case "status":
      return "Statut";
    case "priority":
      return "Priorité";
    case "attachment":
      return "Pièce jointe";
    case "edit":
      return "Modification";
    default:
      return k;
  }
}

export function Maintenance() {
  const [searchParams, setSearchParams] = useSearchParams();
  const bungalowParam = searchParams.get("bungalowId") ?? ALL;

  const [bungalows, setBungalows] = useState<Bungalow[]>([]);
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [events, setEvents] = useState<MaintenanceTicketEvent[]>([]);
  const [attachments, setAttachments] = useState<MaintenanceTicketAttachment[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>(ALL);
  const [filterPriority, setFilterPriority] = useState<string>(ALL);
  const [filterBungalow, setFilterBungalow] = useState<string>(bungalowParam || ALL);

  useEffect(() => {
    setFilterBungalow(bungalowParam || ALL);
  }, [bungalowParam]);

  const [bungalowsReady, setBungalowsReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const b = await apiListBungalows();
      if (b === null) {
        setApiError(true);
        setBungalows([]);
      } else {
        setApiError(false);
        setBungalows(b);
      }
      setBungalowsReady(true);
    })();
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const params: { bungalowId?: string; status?: string; priority?: string } = {};
    if (filterBungalow && filterBungalow !== ALL) params.bungalowId = filterBungalow;
    if (filterStatus && filterStatus !== ALL) params.status = filterStatus;
    if (filterPriority && filterPriority !== ALL) params.priority = filterPriority;
    const t = await apiListMaintenanceTickets(params);
    if (t === null) {
      setApiError(true);
      setTickets([]);
    } else {
      setApiError(false);
      setTickets(t);
    }
    setLoading(false);
  }, [filterBungalow, filterPriority, filterStatus]);

  useEffect(() => {
    if (!bungalowsReady) return;
    void fetchTickets();
  }, [bungalowsReady, fetchTickets]);

  const reloadList = useCallback(async () => {
    await fetchTickets();
  }, [fetchTickets]);

  const syncUrlBungalow = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      if (!id || id === ALL) next.delete("bungalowId");
      else next.set("bungalowId", id);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const onChangeFilterBungalow = useCallback(
    (id: string) => {
      setFilterBungalow(id);
      syncUrlBungalow(id);
    },
    [syncUrlBungalow],
  );

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setSelectedId(id);
    const d = await apiGetMaintenanceTicket(id);
    if (!d) {
      setEvents([]);
      setAttachments([]);
      setToast("Ticket introuvable.");
    } else {
      setEvents(d.events);
      setAttachments(d.attachments);
    }
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const filteredTickets = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tickets.filter((t) => {
      if (!s) return true;
      return (
        t.title.toLowerCase().includes(s) ||
        (t.bungalowCode?.toLowerCase().includes(s) ?? false) ||
        t.description.toLowerCase().includes(s)
      );
    });
  }, [q, tickets]);

  const selectedTicket = useMemo(
    () => (selectedId ? tickets.find((x) => x.id === selectedId) ?? null : null),
    [selectedId, tickets],
  );

  return (
    <div>
      <Breadcrumb items={[{ label: "Maintenance technique" }]} />
      <header className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-3 font-display text-4xl tracking-wide text-white">
            <Wrench className="h-9 w-9 shrink-0 text-brand-cream/90" aria-hidden />
            Maintenance technique
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/45">
            Tickets par bungalow (panne, clim, plomberie…), priorité, pièces jointes et fil d’historique pour suivre
            les interventions et limiter les oublis.
          </p>
        </div>
        <NewTicketButton bungalows={bungalows} disabled={apiError} onCreated={reloadList} onToast={setToast} />
      </header>

      {toast && (
        <p className="mb-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80" role="status">
          {toast}
        </p>
      )}

      {apiError && (
        <p
          className="mb-6 rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-sm text-brand-cream/95"
          role="alert"
        >
          Impossible de charger les données. Vérifiez l’API et la session.
        </p>
      )}

      <div className="mb-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher titre, bungalow…"
            disabled={loading}
            className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-4 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/30 focus:border-brand-orange/35 focus:ring-2 disabled:opacity-40"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-1">
          <Filter className="ml-2 h-4 w-4 shrink-0 text-white/35" />
          <select
            aria-label="Filtrer par bungalow"
            value={filterBungalow}
            onChange={(e) => onChangeFilterBungalow(e.target.value)}
            disabled={loading}
            className="max-w-[200px] rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs font-medium text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
          >
            <option value={ALL}>Tous les bungalows</option>
            {bungalows.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrer par statut"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value || ALL)}
            disabled={loading}
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs font-medium text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
          >
            <option value={ALL}>Tous statuts</option>
            {(Object.keys(ST_LABEL) as MaintenanceTicketStatus[]).map((k) => (
              <option key={k} value={k}>
                {ST_LABEL[k]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrer par priorité"
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value || ALL)}
            disabled={loading}
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs font-medium text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
          >
            <option value={ALL}>Toutes priorités</option>
            {(Object.keys(PRI_LABEL) as MaintenanceTicketPriority[]).map((k) => (
              <option key={k} value={k}>
                {PRI_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!bungalowsReady || (loading && !tickets.length) ? (
        <p className="py-16 text-center text-white/45">Chargement…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <motion.ul
            className="space-y-3 lg:col-span-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {filteredTickets.length === 0 ? (
              <li className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-10 text-center text-sm text-white/40">
                Aucun ticket. Créez-en un pour ce bungalow ou assouplissez les filtres.
              </li>
            ) : (
              filteredTickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => void loadDetail(t.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                      selectedId === t.id
                        ? "border-brand-orange/45 bg-brand-orange/10"
                        : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/30"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white">{t.title}</span>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorityClass(t.priority)}`}
                      >
                        {PRI_LABEL[t.priority]}
                      </span>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(t.status)}`}
                      >
                        {ST_LABEL[t.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/45">
                      {t.bungalowCode ? (
                        <Link
                          to={`/bungalows/${t.bungalowId}`}
                          className="text-brand-orange/90 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t.bungalowCode}
                        </Link>
                      ) : (
                        t.bungalowId
                      )}{" "}
                      · {CAT_LABEL[t.category]} · maj {t.updatedAt.replace("T", " ").slice(0, 16)}
                    </p>
                  </button>
                </li>
              ))
            )}
          </motion.ul>

          <div className="lg:col-span-3">
            {!selectedId ? (
              <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-16 text-center text-sm text-white/40">
                Sélectionnez un ticket pour voir le détail, l’historique et les pièces jointes.
              </div>
            ) : detailLoading ? (
              <p className="py-12 text-center text-white/45">Chargement du ticket…</p>
            ) : selectedTicket ? (
              <TicketDetailPanel
                ticket={selectedTicket}
                events={events}
                attachments={attachments}
                onUpdated={async () => {
                  await reloadList();
                  await loadDetail(selectedTicket.id);
                }}
                onToast={setToast}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function NewTicketButton({
  bungalows,
  disabled,
  onCreated,
  onToast,
}: {
  bungalows: Bungalow[];
  disabled: boolean;
  onCreated: () => Promise<void>;
  onToast: (s: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [bungalowId, setBungalowId] = useState("");
  const [category, setCategory] = useState<MaintenanceTicketCategory>("panne");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<MaintenanceTicketPriority>("normale");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!bungalowId || !title.trim()) {
      onToast("Bungalow et titre obligatoires.");
      return;
    }
    setSaving(true);
    const res = await apiCreateMaintenanceTicket({
      bungalowId,
      category,
      title: title.trim(),
      description: description.trim(),
      priority,
    });
    setSaving(false);
    if (!res.ok) {
      onToast("Échec de la création.");
      return;
    }
    setOpen(false);
    setTitle("");
    setDescription("");
    setCategory("panne");
    setPriority("normale");
    onToast(`Ticket créé : ${res.ticket.title}`);
    await onCreated();
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-xl border border-brand-orange/40 bg-brand-red/30 px-4 py-2.5 text-sm font-semibold text-white shadow-glow-sm transition-colors hover:bg-brand-red/45 disabled:opacity-40"
      >
        <Plus className="h-4 w-4" />
        Nouveau ticket
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute right-0 z-30 mt-3 w-[min(100vw-2rem,420px)] rounded-2xl border border-white/15 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-xl"
        >
          <h2 className="text-sm font-semibold text-white">Créer un ticket</h2>
          <div className="mt-3 space-y-3 text-sm">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Bungalow</span>
              <select
                value={bungalowId}
                onChange={(e) => setBungalowId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
              >
                <option value="">— Choisir —</option>
                {bungalows.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Catégorie</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as MaintenanceTicketCategory)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
              >
                {(Object.keys(CAT_LABEL) as MaintenanceTicketCategory[]).map((k) => (
                  <option key={k} value={k}>
                    {CAT_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Titre</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Priorité</span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as MaintenanceTicketPriority)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
              >
                {(Object.keys(PRI_LABEL) as MaintenanceTicketPriority[]).map((k) => (
                  <option key={k} value={k}>
                    {PRI_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/5"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="rounded-lg bg-brand-orange/90 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? "…" : "Créer"}
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function TicketDetailPanel({
  ticket,
  events,
  attachments,
  onUpdated,
  onToast,
}: {
  ticket: MaintenanceTicket;
  events: MaintenanceTicketEvent[];
  attachments: MaintenanceTicketAttachment[];
  onUpdated: () => Promise<void>;
  onToast: (s: string | null) => void;
}) {
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(ticket.status);
    setPriority(ticket.priority);
  }, [ticket.id, ticket.status, ticket.priority]);

  const saveMeta = async () => {
    setSaving(true);
    const res = await apiPatchMaintenanceTicket(ticket.id, { status, priority });
    setSaving(false);
    if (!res.ok) {
      onToast("Échec de la mise à jour.");
      return;
    }
    onToast("Ticket mis à jour.");
    await onUpdated();
  };

  const sendComment = async () => {
    const t = comment.trim();
    if (!t) return;
    setSaving(true);
    const res = await apiPostMaintenanceTicketComment(ticket.id, t);
    setSaving(false);
    if (!res.ok) {
      onToast("Échec de l’envoi du commentaire.");
      return;
    }
    setComment("");
    onToast("Commentaire ajouté.");
    await onUpdated();
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setSaving(true);
    const res = await apiPostMaintenanceTicketAttachment(ticket.id, f);
    setSaving(false);
    if (!res.ok) {
      onToast(
        res.code === "unsupported_mime"
          ? "Format non accepté (JPEG, PNG, WebP, PDF)."
          : res.code === "file_too_large"
            ? "Fichier trop volumineux (max 2 Mo)."
            : "Échec de l’envoi du fichier.",
      );
      return;
    }
    onToast("Pièce jointe ajoutée.");
    await onUpdated();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 rounded-2xl border border-white/10 bg-black/20 p-5"
    >
      <div>
        <h2 className="font-display text-2xl text-white">{ticket.title}</h2>
        <p className="mt-1 text-xs text-white/45">
          {ticket.bungalowCode ?? ticket.bungalowId} · {CAT_LABEL[ticket.category]} · créé {ticket.createdAt}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/70">{ticket.description || "—"}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col text-xs text-white/50">
          Statut
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MaintenanceTicketStatus)}
            className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
          >
            {(Object.keys(ST_LABEL) as MaintenanceTicketStatus[]).map((k) => (
              <option key={k} value={k}>
                {ST_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-white/50">
          Priorité
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as MaintenanceTicketPriority)}
            className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
          >
            {(Object.keys(PRI_LABEL) as MaintenanceTicketPriority[]).map((k) => (
              <option key={k} value={k}>
                {PRI_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            disabled={saving || (status === ticket.status && priority === ticket.priority)}
            onClick={() => void saveMeta()}
            className="rounded-lg bg-brand-red/50 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Enregistrer
          </button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
          <Paperclip className="h-4 w-4" />
          Pièces jointes
        </h3>
        <ul className="space-y-2">
          {attachments.length === 0 ? (
            <li className="text-sm text-white/35">Aucune pièce jointe.</li>
          ) : (
            attachments.map((a) => (
              <li key={a.id}>
                <a
                  href={apiMaintenanceAttachmentFileUrl(ticket.id, a.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-brand-orange/90 hover:underline"
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  {a.fileName}
                  <span className="text-white/35">({formatBytes(a.byteLength)})</span>
                </a>
              </li>
            ))
          )}
        </ul>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10">
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => void onPickFile(e)} disabled={saving} />
          Ajouter un fichier (max 2 Mo)
        </label>
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
          <MessageSquarePlus className="h-4 w-4" />
          Historique
        </h3>
        <ul className="max-h-72 space-y-3 overflow-y-auto pr-1 text-sm">
          {events.map((ev) => (
            <li key={ev.id} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                <span>{eventKindLabel(ev.kind)}</span>
                <span>·</span>
                <span>{ev.createdAt.replace("T", " ").slice(0, 19)}</span>
                {ev.userName && (
                  <>
                    <span>·</span>
                    <span className="text-white/55">{ev.userName}</span>
                  </>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-white/75">{ev.body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Ajouter un commentaire…"
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
          />
          <button
            type="button"
            disabled={saving || !comment.trim()}
            onClick={() => void sendComment()}
            className="shrink-0 self-end rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Envoyer
          </button>
        </div>
      </div>
    </motion.div>
  );
}
