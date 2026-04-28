import { useAuth } from "@/auth/AuthContext";
import { useTheme } from "@/theme/ThemeContext";
import type { ThemePreference } from "@/theme/themeStorage";
import { DEMO_PASSWORDS } from "@/auth/demoPasswords";
import { SHOW_DEMO_HINT } from "@/config/authMode";
import { systemUsers } from "@/data/mock";
import { motion } from "framer-motion";
import { Loader2, Lock, Mail, Monitor, Moon, Shield, Sun } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

const ERRORS: Record<string, string> = {
  invalid_credentials: "E-mail ou mot de passe incorrect.",
  inactive: "Ce compte est désactivé. Contactez un administrateur.",
  network_error: "Impossible de joindre le serveur. Vérifiez que l’API est démarrée (npm run dev).",
  "2fa_required":
    "Code 2FA requis : saisissez le code à 6 chiffres de votre application d’authentification.",
  invalid_totp: "Code 2FA incorrect ou expiré. Réessayez.",
};

const loginThemeOptions: { id: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { id: "dark", label: "Sombre", Icon: Moon },
  { id: "light", label: "Clair", Icon: Sun },
  { id: "system", label: "Auto", Icon: Monitor },
];

export function LoginPage() {
  const { user, ready, login } = useAuth();
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (ready && user) {
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const fail = await login(email, password, needs2fa ? totpCode : undefined);
      if (fail) {
        if (fail === "2fa_required") {
          setNeeds2fa(true);
        }
        setError(ERRORS[fail] ?? "Connexion impossible.");
        return;
      }
      navigate(from, { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  const demoRows = SHOW_DEMO_HINT
    ? systemUsers.filter((u) => DEMO_PASSWORDS[u.email.toLowerCase()] !== undefined)
    : [];

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
            <img
              src="/favicon.svg"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
              aria-hidden
            />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-orange/90">HD by ChristFire</p>
          <h1 className="mt-2 font-display text-3xl tracking-wide md:text-4xl">Connexion</h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-white/45">Accès sécurisé à l’espace d’exploitation.</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="glass-panel rounded-2xl p-6 shadow-2xl shadow-stone-900/10 md:p-8 dark:shadow-black/40"
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-white/45"
              >
                E-mail
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-white/35" />
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-stone-200/90 bg-white py-3 pl-10 pr-4 text-sm text-stone-900 outline-none ring-brand-orange/40 placeholder:text-stone-400 focus:border-brand-orange/35 focus:ring-2 dark:border-white/10 dark:bg-black/35 dark:text-white dark:placeholder:text-white/30"
                  placeholder="vous@exemple.fr"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="login-password"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-white/45"
              >
                Mot de passe
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-white/35" />
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-stone-200/90 bg-white py-3 pl-10 pr-4 text-sm text-stone-900 outline-none ring-brand-orange/40 placeholder:text-stone-400 focus:border-brand-orange/35 focus:ring-2 dark:border-white/10 dark:bg-black/35 dark:text-white dark:placeholder:text-white/30"
                  placeholder="••••••••"
                />
              </div>
            </div>
            {needs2fa ? (
              <div>
                <label
                  htmlFor="login-totp"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-white/45"
                >
                  Code 2FA
                </label>
                <div className="relative">
                  <Shield className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-white/35" />
                  <input
                    id="login-totp"
                    name="totp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    className="w-full rounded-xl border border-stone-200/90 bg-white py-3 pl-10 pr-4 font-mono text-sm text-stone-900 outline-none ring-brand-orange/40 placeholder:text-stone-400 focus:border-brand-orange/35 focus:ring-2 dark:border-white/10 dark:bg-black/35 dark:text-white dark:placeholder:text-white/30"
                    placeholder="000000"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-stone-500 dark:text-white/35">
                  Ouvrez votre application d’authentification (Google Authenticator, etc.) et saisissez le code à 6
                  chiffres.
                </p>
              </div>
            ) : null}
          </div>

          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-lg border border-brand-red/35 bg-brand-red/10 px-3 py-2 text-sm text-brand-cream/95"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={submitting || !ready}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange py-3 text-sm font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {submitting ? "Connexion…" : "Se connecter"}
          </button>
        </form>

        {demoRows.length > 0 && (
          <motion.div
            className="mt-6 rounded-2xl border border-dashed border-stone-300/80 bg-stone-100/80 p-4 text-xs text-stone-600 dark:border-white/15 dark:bg-black/20 dark:text-white/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
          >
            <p className="font-semibold text-stone-800 dark:text-white/55">
              Comptes de test (serveur API + VITE_SHOW_DEMO_HINT)
            </p>
            <ul className="mt-2 space-y-1.5">
              {demoRows.map((u) => (
                <li key={u.id}>
                  <span className="text-brand-cream/80">{u.email}</span>
                  <span className="text-stone-400 dark:text-white/25"> · </span>
                  <code className="rounded bg-stone-200/80 px-1 py-0.5 text-[10px] text-brand-red dark:bg-white/5 dark:text-brand-orange/90">
                    {DEMO_PASSWORDS[u.email.toLowerCase()]}
                  </code>
                  <span className="text-stone-400 dark:text-white/25"> — </span>
                  <span className="text-stone-600 dark:text-white/35">
                    {u.role}
                    {!u.active ? (
                      <span className="text-stone-500 dark:text-white/25"> (inactif — connexion refusée)</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] leading-relaxed text-stone-500 dark:text-white/30">
              En production publique, ne définissez pas VITE_SHOW_DEMO_HINT et changez tous les mots de passe après le
              premier déploiement.
            </p>
          </motion.div>
        )}

        <p className="mt-8 text-center text-sm text-stone-600 dark:text-white/45">
          <Link
            to="/accepter-invitation"
            className="font-medium text-brand-red hover:underline dark:text-brand-orange/90"
          >
            J’ai reçu une invitation
          </Link>
        </p>

        <div
          className="mt-10 flex flex-wrap items-center justify-center gap-2 border-t border-stone-200/60 pt-6 dark:border-white/10"
          role="group"
          aria-label="Thème d’affichage"
        >
          <span className="w-full text-center text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-white/35">
            Thème
          </span>
          {loginThemeOptions.map(({ id, label, Icon }) => {
            const on = preference === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPreference(id)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  on
                    ? "border-brand-orange/45 bg-brand-red/15 text-stone-900 dark:text-brand-cream"
                    : "border-stone-200/80 text-stone-600 hover:bg-stone-100 dark:border-white/15 dark:text-white/55 dark:hover:bg-white/5"
                }`}
              >
                <Icon className="h-3.5 w-3.5 opacity-90" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
