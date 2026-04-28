import { useAuth } from "@/auth/AuthContext";
import { defaultLogistiquePath } from "@/lib/logistiqueNavBuckets";
import { Navigate } from "react-router-dom";

/** `/logistique` → première section autorisée pour l’utilisateur. */
export function LogistiqueIndexRedirect() {
  const { user } = useAuth();
  return <Navigate to={defaultLogistiquePath(user ?? null)} replace />;
}
