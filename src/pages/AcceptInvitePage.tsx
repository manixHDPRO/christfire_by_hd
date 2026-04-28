import { apiAcceptInvite, apiGetInvitePreview, type InvitePreview } from "@/lib/api";
import { motion } from "framer-motion";
import { Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token")?.trim() ?? "";

  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreviewError("Lien d’invitation incomplet (paramètre token manquant).");
      setLoadingPreview(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await apiGetInvitePreview(token);
      if (cancelled) return;
      setLoadingPreview(false);
      if (!res.ok) {
        if (res.code === "invite_expired") {
          setPreviewError(
            "Cette invitation a expiré. Demandez à un administrateur ou à la réception d’en envoyer une nouvelle.",
          );
        } else if (res.code === "invite_not_found") {
          setPreviewError("Invitation introuvable ou déjà utilisée.");
        } else if (res.code === "invalid_token") {
          setPreviewError("Lien d’invitation invalide.");
        } else {
          setPreviewError("Impossible de vérifier l’invitation. Réessayez plus tard.");
        }
        return;
      }
      setPreview(res.preview);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    if (password.length < 8) {
      setSubmitErr("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== password2) {
      setSubmitErr("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiAcceptInvite(token, password);
      if (!res.ok) {
        if (res.code === "invite_expired") setSubmitErr("Cette invitation a expiré.");
        else if (res.code === "invite_not_found") setSubmitErr("Invitation introuvable ou déjà utilisée.");
        else if (res.code === "email_taken") setSubmitErr("Un compte existe déjà avec cet e-mail.");
        else if (res.code === "validation_error") setSubmitErr("Mot de passe invalide (min. 8 caractères).");
        else setSubmitErr("Création du compte impossible. Réessayez.");
        return;
      }
      window.location.replace("/");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-mesh relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12 text-stone-900 dark:text-white">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-0 h-[50vh] w-[120vw] -translate-x-1/2 bg-gradient-to-b from-brand-red/25 via-transparent to-transparent blur-3xl" />
      </div>

      <motion.div
        className="relative w-full max-w-md"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-brand-orange/40 bg-gradient-to-br from-brand-red to-brand-red-orange shadow-glow-sm">
            <img src="/favicon.svg" alt="" width={40} height={40} className="h-10 w-10 object-contain" aria-hidden />
          </div>
          <h1 className="font-display text-2xl tracking-wide text-brand-cream/95">Accepter l’invitation</h1>
          <p className="mt-2 text-sm text-white/45">HD by ChristFire — création de votre accès sécurisé</p>
        </div>

        <div className="glass-panel rounded-2xl border border-white/10 p-6 shadow-xl">
          {loadingPreview ? (
            <div className="flex flex-col items-center gap-3 py-10 text-sm text-white/50">
              <Loader2 className="h-8 w-8 animate-spin text-brand-orange" aria-hidden />
              Vérification du lien…
            </div>
          ) : previewError ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-brand-cream/90" role="alert">
                {previewError}
              </p>
              <Link
                to="/connexion"
                className="inline-flex text-sm font-medium text-brand-orange hover:text-brand-cream"
              >
                Retour à la connexion
              </Link>
            </div>
          ) : preview ? (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm">
                <p className="font-medium text-white/90">{preview.name}</p>
                <p className="mt-1 text-white/50">{preview.email}</p>
                <p className="mt-2 text-[11px] uppercase tracking-wider text-white/35">
                  Rôle :{" "}
                  <span className="text-brand-orange/90">{preview.role}</span>
                </p>
              </div>

              <div>
                <label htmlFor="accept-invite-pass" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                  Mot de passe
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                  <input
                    id="accept-invite-pass"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/35 py-2.5 pl-10 pr-3 text-sm text-white outline-none focus:border-brand-orange/35"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="accept-invite-pass2" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                  Confirmer le mot de passe
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                  <input
                    id="accept-invite-pass2"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/35 py-2.5 pl-10 pr-3 text-sm text-white outline-none focus:border-brand-orange/35"
                  />
                </div>
              </div>

              {submitErr ? (
                <p className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                  {submitErr}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange py-2.5 text-sm font-semibold uppercase tracking-wide text-white shadow-glow-sm disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Création…
                  </>
                ) : (
                  "Activer mon compte"
                )}
              </button>

              <p className="text-center text-xs text-white/35">
                <Link to="/connexion" className="text-brand-orange/90 hover:text-brand-cream">
                  Déjà un compte ? Connexion
                </Link>
              </p>
            </form>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}
