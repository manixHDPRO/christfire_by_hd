import { useAuth } from "@/auth/AuthContext";
import { Navigate, Outlet, useLocation } from "react-router-dom";

export function ProtectedRoute() {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="app-mesh flex min-h-screen items-center justify-center text-sm text-stone-600 dark:text-white/50">
        Chargement de la session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
