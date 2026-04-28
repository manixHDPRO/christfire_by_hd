import { logistiquePathFromLegacyOnglet } from "@/lib/logistiqueNavBuckets";
import { Navigate, useSearchParams } from "react-router-dom";

/** Redirige `/stocks?onglet=…` vers `/logistique/:section`. */
export function StocksLegacyRedirect() {
  const [sp] = useSearchParams();
  return <Navigate to={logistiquePathFromLegacyOnglet(sp.get("onglet"))} replace />;
}
