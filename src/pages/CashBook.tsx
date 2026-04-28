import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  apiCreateFinanceCashAccount,
  apiCreateFinanceCashMovement,
  apiListFinanceCashAccounts,
  apiListFinanceCashMovements,
} from "@/lib/api";
import { parseLedgerIntegerInput } from "@/lib/parseLedgerIntegerInput";
import type { FinanceCashAccount, FinanceCashMovement, FinanceCashMovementCategory } from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import { BookText, Landmark, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const CATEGORIES: { value: FinanceCashMovementCategory; label: string; hint: string }[] = [
  { value: "expense", label: "Dépense", hint: "Argent qui sort (caisse ou banque), sans contrepartie interne." },
  { value: "bank_deposit", label: "Dépôt bancaire", hint: "Transfert caisse (espèces) → compte bancaire." },
  { value: "bank_withdrawal", label: "Retrait banque → caisse", hint: "Retrait du compte vers la caisse physique." },
  { value: "adjustment_in", label: "Entrée / ajustement (+)", hint: "Augmente un compte (ex. solde initial, correction)." },
  { value: "adjustment_out", label: "Sortie / ajustement (-)", hint: "Diminue un compte (ex. correction, écart)." },
];

function categoryLabel(c: FinanceCashMovementCategory): string {
  return CATEGORIES.find((x) => x.value === c)?.label ?? c;
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
  start.setDate(start.getDate() - 30);
  return { from: localDateKey(start), to: localDateKey(end) };
}

function formErrMessage(code: string): string {
  switch (code) {
    case "validation_error":
      return "Vérifiez les montants et les comptes.";
    case "invalid_accounts":
      return "Combinaison de comptes invalide pour ce type de mouvement.";
    case "invalid_account_kinds":
      return "Pour un dépôt : caisse physique → banque. Pour un retrait : banque → caisse.";
    case "currency_mismatch":
      return "La devise doit correspondre à celle du compte.";
    case "unknown_account":
      return "Compte introuvable ou inactif.";
    case "code_exists":
      return "Ce code compte existe déjà.";
    case "unauthorized":
      return "Session expirée.";
    case "forbidden":
      return "Droits insuffisants (livre de caisse).";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "Enregistrement impossible. Réessayez.";
  }
}

export function CashBook() {
  const [accounts, setAccounts] = useState<FinanceCashAccount[]>([]);
  const [movements, setMovements] = useState<FinanceCashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [filterFrom, setFilterFrom] = useState(() => defaultRange().from);
  const [filterTo, setFilterTo] = useState(() => defaultRange().to);
  const [filterAccountId, setFilterAccountId] = useState("");

  const [category, setCategory] = useState<FinanceCashMovementCategory>("expense");
  const [occurredAt, setOccurredAt] = useState(() => localDateKey(new Date()));
  const [amountStr, setAmountStr] = useState("");
  const [currency, setCurrency] = useState<"CDF" | "USD">("CDF");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [twinDate, setTwinDate] = useState(() => localDateKey(new Date()));
  const [twinAmountStr, setTwinAmountStr] = useState("100.000.000.000");
  const [twinLabel, setTwinLabel] = useState("Apport / solde initial CDF");
  const [twinNote, setTwinNote] = useState("");
  const [twinBusy, setTwinBusy] = useState(false);
  const [twinErr, setTwinErr] = useState<string | null>(null);
  const [twinOkFlash, setTwinOkFlash] = useState(false);

  const [newAccLabel, setNewAccLabel] = useState("");
  const [newAccKind, setNewAccKind] = useState<"physical" | "bank">("bank");
  const [newAccCurrency, setNewAccCurrency] = useState<"CDF" | "USD">("CDF");
  const [newAccCode, setNewAccCode] = useState("");
  const [accBusy, setAccBusy] = useState(false);
  const [accErr, setAccErr] = useState<string | null>(null);
  const [showNewAcc, setShowNewAcc] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [acc, mov] = await Promise.all([
      apiListFinanceCashAccounts(),
      apiListFinanceCashMovements({
        from: filterFrom.trim() || undefined,
        to: filterTo.trim() || undefined,
        accountId: filterAccountId.trim() || undefined,
      }),
    ]);
    setLoading(false);
    if (acc === null || mov === null) {
      setApiError(true);
      setAccounts([]);
      setMovements([]);
      return;
    }
    setApiError(false);
    setAccounts(acc);
    setMovements(mov);
  }, [filterAccountId, filterFrom, filterTo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const accountsFilteredByCurrency = useMemo(
    () => accounts.filter((a) => a.currency === currency),
    [accounts, currency],
  );

  const physicalAccounts = useMemo(
    () => accountsFilteredByCurrency.filter((a) => a.kind === "physical"),
    [accountsFilteredByCurrency],
  );
  const bankAccounts = useMemo(
    () => accountsFilteredByCurrency.filter((a) => a.kind === "bank"),
    [accountsFilteredByCurrency],
  );

  /** Comptes semés par défaut (CAISSE_CDF / BANQUE_CDF) ou premier physique / banque en CDF. */
  const mainCdfCaisseBanque = useMemo(() => {
    const cdf = accounts.filter((a) => a.currency === "CDF");
    const physical =
      cdf.find((a) => a.code.toUpperCase() === "CAISSE_CDF") ?? cdf.find((a) => a.kind === "physical") ?? null;
    const bank =
      cdf.find((a) => a.code.toUpperCase() === "BANQUE_CDF") ?? cdf.find((a) => a.kind === "bank") ?? null;
    return { physical, bank };
  }, [accounts]);

  const submitMovement = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormErr(null);
      const amount = parseLedgerIntegerInput(amountStr);
      if (!Number.isFinite(amount) || amount < 1) {
        setFormErr("Indiquez un montant entier ≥ 1.");
        return;
      }
      if (amount > Number.MAX_SAFE_INTEGER) {
        setFormErr(
          `Montant trop élevé pour l’application (max ${Number.MAX_SAFE_INTEGER.toLocaleString("fr-FR")}).`,
        );
        return;
      }
      if (!label.trim()) {
        setFormErr("Libellé obligatoire (ex. courses, loyer, dépôt Rawbank…).");
        return;
      }

      let sourceAccountId: string | null | undefined = sourceId.trim() || null;
      let targetAccountId: string | null | undefined = targetId.trim() || null;
      if (category === "adjustment_in") sourceAccountId = null;
      if (category === "adjustment_out" || category === "expense") targetAccountId = null;

      setSubmitBusy(true);
      try {
        const res = await apiCreateFinanceCashMovement({
          category,
          occurredAt,
          sourceAccountId,
          targetAccountId,
          amount,
          currency,
          label: label.trim(),
          note: note.trim(),
        });
        if (!res.ok) {
          setFormErr(formErrMessage(res.code));
          return;
        }
        setAmountStr("");
        setLabel("");
        setNote("");
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 2500);
        await reload();
      } finally {
        setSubmitBusy(false);
      }
    },
    [amountStr, category, currency, label, note, occurredAt, reload, sourceId, targetId],
  );

  const submitTwinCdfAdjustment = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setTwinErr(null);
      const { physical, bank } = mainCdfCaisseBanque;
      if (!physical || !bank) {
        setTwinErr(
          "Impossible de trouver deux comptes CDF (caisse + banque). Vérifiez les codes CAISSE_CDF et BANQUE_CDF ou créez les comptes.",
        );
        return;
      }
      const amount = parseLedgerIntegerInput(twinAmountStr);
      if (!Number.isFinite(amount) || amount < 1) {
        setTwinErr("Indiquez un montant entier ≥ 1.");
        return;
      }
      if (amount > Number.MAX_SAFE_INTEGER) {
        setTwinErr(`Montant trop élevé (max ${Number.MAX_SAFE_INTEGER.toLocaleString("fr-FR")}).`);
        return;
      }
      const labelBase = twinLabel.trim() || "Apport / solde initial CDF";
      const noteTxt = twinNote.trim();
      const occurred = twinDate.trim() || localDateKey(new Date());
      setTwinBusy(true);
      try {
        const r1 = await apiCreateFinanceCashMovement({
          category: "adjustment_in",
          occurredAt: occurred,
          sourceAccountId: null,
          targetAccountId: physical.id,
          amount,
          currency: "CDF",
          label: `${labelBase} — caisse`,
          note: noteTxt ? `${noteTxt} · ${physical.label}` : `Entrée caisse · ${physical.label}`,
        });
        if (!r1.ok) {
          setTwinErr(formErrMessage(r1.code));
          return;
        }
        const r2 = await apiCreateFinanceCashMovement({
          category: "adjustment_in",
          occurredAt: occurred,
          sourceAccountId: null,
          targetAccountId: bank.id,
          amount,
          currency: "CDF",
          label: `${labelBase} — banque`,
          note: noteTxt ? `${noteTxt} · ${bank.label}` : `Entrée banque · ${bank.label}`,
        });
        if (!r2.ok) {
          setTwinErr(
            `La caisse a été créditée ; l’entrée banque a échoué : ${formErrMessage(r2.code)} Enregistrez la banque manuellement si besoin.`,
          );
          await reload();
          return;
        }
        setTwinOkFlash(true);
        window.setTimeout(() => setTwinOkFlash(false), 3200);
        await reload();
      } finally {
        setTwinBusy(false);
      }
    },
    [mainCdfCaisseBanque, reload, twinAmountStr, twinDate, twinLabel, twinNote],
  );

  const submitAccount = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setAccErr(null);
      if (!newAccLabel.trim()) {
        setAccErr("Libellé du compte requis.");
        return;
      }
      setAccBusy(true);
      try {
        const res = await apiCreateFinanceCashAccount({
          label: newAccLabel.trim(),
          kind: newAccKind,
          currency: newAccCurrency,
          ...(newAccCode.trim() ? { code: newAccCode.trim() } : {}),
        });
        if (!res.ok) {
          setAccErr(formErrMessage(res.code));
          return;
        }
        setNewAccLabel("");
        setNewAccCode("");
        setShowNewAcc(false);
        await reload();
      } finally {
        setAccBusy(false);
      }
    },
    [newAccCurrency, newAccKind, newAccCode, newAccLabel, reload],
  );

  const categoryHint = CATEGORIES.find((c) => c.value === category)?.hint ?? "";

  return (
    <div>
      <Breadcrumb items={[{ label: "Finance", to: "/finance" }, { label: "Livre de caisse" }]} />
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-orange/30 bg-brand-orange/10 text-brand-cream">
            <BookText className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-4xl tracking-wide text-white">Livre de caisse</h1>
            <p className="mt-1 max-w-3xl text-sm text-white/45">
              Suivez les <strong className="text-white/60">soldes</strong> par compte (caisse physique, banque),
              enregistrez chaque <strong className="text-white/60">dépense</strong> et chaque{" "}
              <strong className="text-white/60">dépôt bancaire</strong> ou retrait. Les ventes comptoir et la trésorerie
              terrasses restent dans{" "}
              <Link to="/tresorerie" className="text-brand-orange/90 hover:underline">
                Trésorerie
              </Link>{" "}
              ; ici vous consolidez la caisse centrale et les comptes bancaires du lodge.
            </p>
          </div>
        </div>
      </header>

      {apiError ? (
        <p className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
          Impossible de charger le livre de caisse.
          <button type="button" onClick={() => void reload()} className="ml-2 underline">
            Réessayer
          </button>
        </p>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <p className="text-sm text-white/45">Chargement des soldes…</p>
        ) : (
          accounts.map((a) => (
            <div
              key={a.id}
              className="rounded-2xl border border-white/10 glass-panel px-4 py-3"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                {a.kind === "physical" ? "Caisse" : "Banque"} · {a.currency}
              </p>
              <p className="mt-1 font-display text-xl text-brand-cream/95">{a.label}</p>
              <p
                className={`mt-2 font-mono text-lg ${a.balance < 0 ? "text-rose-300/90" : "text-emerald-200/90"}`}
              >
                {a.balance.toLocaleString("fr-CD")} {a.currency === "CDF" ? "FC" : "$"}
              </p>
            </div>
          ))
        )}
      </div>
      {!loading && !apiError ? (
        <p className="mb-6 text-xs text-white/40">
          Ce bandeau indique seulement le <strong className="text-white/55">solde</strong> de chaque compte. Pour
          saisir un mouvement (dépense, ajustement, etc.) et voir l’historique,{" "}
          <strong className="text-white/55">faites défiler vers le bas</strong> : bloc « Nouveau mouvement » puis liste
          des opérations. Une <strong className="text-white/55">dépense</strong> sort de la caisse (solde qui baisse) ;
          une <strong className="text-white/55">entrée / ajustement (+)</strong> augmente le solde — utile pour des
          tests ou un solde initial.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowNewAcc((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nouveau compte (caisse ou banque)
        </button>
      </div>

      <AnimatePresence>
        {showNewAcc ? (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={submitAccount}
            className="mb-8 overflow-hidden rounded-2xl border border-white/10 glass-panel p-4"
          >
            <h2 className="font-display text-sm tracking-wide text-brand-cream/90">Créer un compte</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <label htmlFor="new-acc-label" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Libellé
                </label>
                <input
                  id="new-acc-label"
                  value={newAccLabel}
                  onChange={(e) => setNewAccLabel(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  placeholder="ex. Rawbank USD, Petite caisse bureau"
                />
              </div>
              <div>
                <label htmlFor="new-acc-kind" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Type
                </label>
                <select
                  id="new-acc-kind"
                  value={newAccKind}
                  onChange={(e) => setNewAccKind(e.target.value as "physical" | "bank")}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                >
                  <option value="physical">Caisse (physique)</option>
                  <option value="bank">Compte bancaire</option>
                </select>
              </div>
              <div>
                <label htmlFor="new-acc-cur" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Devise
                </label>
                <select
                  id="new-acc-cur"
                  value={newAccCurrency}
                  onChange={(e) => setNewAccCurrency(e.target.value as "CDF" | "USD")}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                >
                  <option value="CDF">CDF</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="new-acc-code" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Code interne (optionnel)
                </label>
                <input
                  id="new-acc-code"
                  value={newAccCode}
                  onChange={(e) => setNewAccCode(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  placeholder="ex. RAWBANK_USD"
                />
              </div>
            </div>
            {accErr ? (
              <p className="mt-2 text-xs text-rose-300/90" role="alert">
                {accErr}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={accBusy}
              className="mt-3 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-40"
            >
              {accBusy ? "Création…" : "Créer le compte"}
            </button>
          </motion.form>
        ) : null}
      </AnimatePresence>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,400px)_1fr]">
        <div className="space-y-6">
        <motion.form
          onSubmit={submitMovement}
          className="h-fit space-y-4 rounded-2xl border border-white/10 glass-panel p-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="font-display text-lg tracking-wide text-brand-cream/95">Nouveau mouvement</h2>
          <div>
            <label htmlFor="mov-cat" className="mb-1 block text-[11px] font-semibold uppercase text-white/45">
              Type
            </label>
            <select
              id="mov-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as FinanceCashMovementCategory)}
              disabled={apiError}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-white/35">{categoryHint}</p>
          </div>
          <div>
            <label htmlFor="mov-date" className="mb-1 block text-[11px] font-semibold uppercase text-white/45">
              Date
            </label>
            <input
              id="mov-date"
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              disabled={apiError}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
            />
          </div>
          <div>
            <label htmlFor="mov-cur" className="mb-1 block text-[11px] font-semibold uppercase text-white/45">
              Devise du mouvement
            </label>
            <select
              id="mov-cur"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as "CDF" | "USD")}
              disabled={apiError}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
            >
              <option value="CDF">CDF</option>
              <option value="USD">USD</option>
            </select>
          </div>

          {(category === "expense" ||
            category === "bank_deposit" ||
            category === "bank_withdrawal" ||
            category === "adjustment_out") && (
            <div>
              <label htmlFor="mov-src" className="mb-1 block text-[11px] font-semibold uppercase text-white/45">
                Compte source
              </label>
              <select
                id="mov-src"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                disabled={apiError || accountsFilteredByCurrency.length === 0}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              >
                <option value="">— Choisir —</option>
                {(category === "bank_deposit" ? physicalAccounts : category === "bank_withdrawal" ? bankAccounts : accountsFilteredByCurrency).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({a.kind === "physical" ? "caisse" : "banque"})
                  </option>
                ))}
              </select>
            </div>
          )}

          {(category === "bank_deposit" ||
            category === "bank_withdrawal" ||
            category === "adjustment_in") && (
            <div>
              <label htmlFor="mov-tgt" className="mb-1 block text-[11px] font-semibold uppercase text-white/45">
                Compte cible
              </label>
              <select
                id="mov-tgt"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={apiError || accountsFilteredByCurrency.length === 0}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              >
                <option value="">— Choisir —</option>
                {(category === "bank_deposit" ? bankAccounts : category === "bank_withdrawal" ? physicalAccounts : accountsFilteredByCurrency).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({a.kind === "physical" ? "caisse" : "banque"})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="mov-amt" className="mb-1 block text-[11px] font-semibold uppercase text-white/45">
              Montant
            </label>
            <input
              id="mov-amt"
              type="text"
              inputMode="numeric"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              disabled={apiError}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-lg text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              placeholder={currency === "CDF" ? "ex. 100.000.000.000" : "Montant en USD (entier)"}
            />
            <p className="mt-1 text-[10px] text-white/35">
              Montant entier. Points ou espaces comme séparateurs de milliers (ex.{" "}
              <span className="font-mono text-white/45">100.000.000.000</span> FC).
            </p>
          </div>
          <div>
            <label htmlFor="mov-label" className="mb-1 block text-[11px] font-semibold uppercase text-white/45">
              Libellé
            </label>
            <input
              id="mov-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={apiError}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              placeholder="ex. Courses, Carburant, Dépôt banque du 15/04…"
            />
          </div>
          <div>
            <label htmlFor="mov-note" className="mb-1 block text-[11px] font-semibold uppercase text-white/45">
              Note / référence
            </label>
            <textarea
              id="mov-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={apiError}
              className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              placeholder="N° reçu, relevé bancaire, bénéficiaire…"
            />
          </div>
          {formErr ? (
            <p className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
              {formErr}
            </p>
          ) : null}
          <AnimatePresence>
            {savedFlash ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs text-emerald-300/90"
              >
                Mouvement enregistré.
              </motion.p>
            ) : null}
          </AnimatePresence>
          <button
            type="submit"
            disabled={apiError || submitBusy}
            className="w-full rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange py-3 text-sm font-semibold text-white shadow-glow-sm hover:opacity-95 disabled:opacity-40"
          >
            {submitBusy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </motion.form>

        <div className="space-y-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-6">
          <h3 className="font-display text-base tracking-wide text-emerald-100/95">
            Double entrée CDF — caisse + banque
          </h3>
          <p className="text-[11px] text-white/45">
            Enregistre <strong className="text-white/60">deux</strong> mouvements « Entrée / ajustement (+) » : le même
            montant sur la <strong className="text-white/60">caisse principale</strong> et sur le{" "}
            <strong className="text-white/60">compte bancaire principal</strong> (comptes repérés par les codes{" "}
            <span className="font-mono text-white/50">CAISSE_CDF</span> et{" "}
            <span className="font-mono text-white/50">BANQUE_CDF</span>, ou premier compte physique / banque en CDF).
          </p>
          {mainCdfCaisseBanque.physical && mainCdfCaisseBanque.bank ? (
            <p className="text-[11px] text-white/55">
              <span className="text-white/40">Caisse :</span> {mainCdfCaisseBanque.physical.label}
              <span className="mx-2 text-white/25">·</span>
              <span className="text-white/40">Banque :</span> {mainCdfCaisseBanque.bank.label}
            </p>
          ) : (
            <p className="text-[11px] text-amber-200/85">
              Comptes CDF incomplets : créez au moins une caisse et un compte banque en CDF.
            </p>
          )}
          <form onSubmit={(e) => void submitTwinCdfAdjustment(e)} className="space-y-3">
            <div>
              <label htmlFor="twin-date" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Date
              </label>
              <input
                id="twin-date"
                type="date"
                value={twinDate}
                onChange={(e) => setTwinDate(e.target.value)}
                disabled={apiError}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none disabled:opacity-40"
              />
            </div>
            <div>
              <label htmlFor="twin-amt" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Montant (CDF, identique pour les deux comptes)
              </label>
              <input
                id="twin-amt"
                type="text"
                inputMode="numeric"
                value={twinAmountStr}
                onChange={(e) => setTwinAmountStr(e.target.value)}
                disabled={apiError}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none disabled:opacity-40"
                placeholder="100.000.000.000"
              />
            </div>
            <div>
              <label htmlFor="twin-label" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Libellé (préfixe commun)
              </label>
              <input
                id="twin-label"
                value={twinLabel}
                onChange={(e) => setTwinLabel(e.target.value)}
                disabled={apiError}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none disabled:opacity-40"
              />
            </div>
            <div>
              <label htmlFor="twin-note" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Note (optionnel)
              </label>
              <input
                id="twin-note"
                value={twinNote}
                onChange={(e) => setTwinNote(e.target.value)}
                disabled={apiError}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none disabled:opacity-40"
                placeholder="ex. Constitution initiale trésorerie"
              />
            </div>
            {twinErr ? (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90" role="alert">
                {twinErr}
              </p>
            ) : null}
            {twinOkFlash ? (
              <p className="text-xs text-emerald-300/90">Les deux entrées CDF ont été enregistrées.</p>
            ) : null}
            <button
              type="submit"
              disabled={
                apiError ||
                twinBusy ||
                !mainCdfCaisseBanque.physical ||
                !mainCdfCaisseBanque.bank
              }
              className="w-full rounded-xl border border-emerald-500/40 bg-emerald-600/25 py-3 text-sm font-semibold text-emerald-50 hover:bg-emerald-600/35 disabled:opacity-40"
            >
              {twinBusy ? "Enregistrement des deux mouvements…" : "Enregistrer les deux entrées (100 Mds × 2 si inchangé)"}
            </button>
          </form>
        </div>
        </div>

        <div className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div>
              <label htmlFor="flt-du" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Du
              </label>
              <input
                id="flt-du"
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
              />
            </div>
            <div>
              <label htmlFor="flt-au" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Au
              </label>
              <input
                id="flt-au"
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
              />
            </div>
            <div>
              <label htmlFor="flt-acc" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Compte
              </label>
              <select
                id="flt-acc"
                value={filterAccountId}
                onChange={(e) => setFilterAccountId(e.target.value)}
                className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
              >
                <option value="">Tous</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void reload()}
              className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/75 hover:bg-white/10"
            >
              Filtrer
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Flux</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Libellé</th>
                  <th className="px-4 py-3">Par</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-white/45">
                      Chargement…
                    </td>
                  </tr>
                ) : movements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-white/45">
                      Aucun mouvement sur cette période.
                    </td>
                  </tr>
                ) : (
                  movements.map((m) => (
                    <tr key={m.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 whitespace-nowrap text-white/55">
                        {m.occurredAt.includes("T") ? m.occurredAt.replace("T", " ").slice(0, 16) : m.occurredAt}
                      </td>
                      <td className="px-4 py-3 text-white/50">{categoryLabel(m.category)}</td>
                      <td className="px-4 py-3 text-xs text-white/45">
                        {m.sourceAccountLabel ? (
                          <span>
                            − {m.sourceAccountLabel}
                            {m.targetAccountLabel ? " → " : ""}
                          </span>
                        ) : null}
                        {m.targetAccountLabel ? <span>+ {m.targetAccountLabel}</span> : null}
                        {!m.sourceAccountLabel && !m.targetAccountLabel ? "—" : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-brand-cream/90">
                        {m.amount.toLocaleString("fr-CD")} {m.currency === "CDF" ? "FC" : "$"}
                      </td>
                      <td className="px-4 py-3 text-white/55">
                        {m.label}
                        {m.note ? <span className="mt-0.5 block text-[11px] text-white/35">{m.note}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-white/40">{m.createdByName ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 flex items-center gap-2 text-[11px] text-white/30">
            <Landmark className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Jusqu’à 500 mouvements les plus récents selon les filtres. Les soldes incluent tous les mouvements en base.
          </p>
        </div>
      </div>
    </div>
  );
}
