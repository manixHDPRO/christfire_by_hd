import { useAuth } from "@/auth/AuthContext";
import { userHasAnyPermission } from "@/lib/permissions";
import { Link, Navigate, useLocation } from "react-router-dom";

/** Accueil : au moins un droit dans la matrice (les admins app ont déjà tout). */
export function RequireSessionAccess({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="app-mesh flex min-h-[40vh] items-center justify-center text-sm text-white/50">
        Chargement de la session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  }

  if (!user.isAppAdmin && (user.permissions?.length ?? 0) === 0) {
    return (
      <div className="app-mesh flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="max-w-md text-sm text-white/70">
          Aucun droit n’est attribué à votre rôle. Un administrateur application doit cocher au moins une case dans la
          matrice des droits (section Paramètres, réservée aux administrateurs) pour votre profil.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

/** Page Paramètres : réservée aux rôles marqués « administrateur application » en base. */
export function RequireAppAdmin({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="app-mesh flex min-h-[40vh] items-center justify-center text-sm text-white/50">
        Chargement de la session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  }

  if (!user.isAppAdmin) {
    return (
      <div className="app-mesh flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="max-w-md text-sm text-white/70">
          La configuration de l’application (paramètres, rôles, utilisateurs…) est réservée aux comptes administrateur
          application.
        </p>
        <Link to="/" className="text-sm font-semibold text-brand-orange hover:underline">
          Retour au tableau de bord
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}

export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: readonly string[];
  children: React.ReactNode;
}) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="app-mesh flex min-h-[40vh] items-center justify-center text-sm text-white/50">
        Chargement de la session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  }

  if (!userHasAnyPermission(user, anyOf)) {
    return (
      <div className="app-mesh flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="max-w-md text-sm text-white/70">
          Vous n’avez pas les droits nécessaires pour accéder à cette section. Un administrateur application peut ajuster
          la matrice des droits de votre rôle.
        </p>
        <Link to="/" className="text-sm font-semibold text-brand-orange hover:underline">
          Retour au tableau de bord
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
