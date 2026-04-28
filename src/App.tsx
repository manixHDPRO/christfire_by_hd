import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { RequireAppAdmin, RequirePermission, RequireSessionAccess } from "@/components/auth/RequirePermission";
import { AppShell } from "@/components/layout/AppShell";
import { HEBERGEMENT_ROUTE_PERMS } from "@/lib/hebergementPermissions";
import { mainNavRequiredPermissions } from "@/lib/navRoutePermissions";
import { BungalowDetail } from "@/pages/BungalowDetail";
import { Bungalows } from "@/pages/Bungalows";
import { ClientDetail } from "@/pages/ClientDetail";
import { Clients } from "@/pages/Clients";
import { CounterSales } from "@/pages/CounterSales";
import { Dashboard } from "@/pages/Dashboard";
import { CashBook } from "@/pages/CashBook";
import { Finance } from "@/pages/Finance";
import { Housekeeping } from "@/pages/Housekeeping";
import { Maintenance } from "@/pages/Maintenance";
import { NightAudit } from "@/pages/NightAudit";
import { Invoices } from "@/pages/Invoices";
import { AcceptInvitePage } from "@/pages/AcceptInvitePage";
import { LoginPage } from "@/pages/LoginPage";
import { Payments } from "@/pages/Payments";
import { AccueilSejour } from "@/pages/AccueilSejour";
import { Reports } from "@/pages/Reports";
import { Reservations } from "@/pages/Reservations";
import { Settings } from "@/pages/Settings";
import { LogistiqueIndexRedirect } from "@/pages/LogistiqueIndexRedirect";
import { Stocks } from "@/pages/Stocks";
import { StocksLegacyRedirect } from "@/pages/StocksLegacyRedirect";
import { Treasury } from "@/pages/Treasury";
import { Navigate, Route, Routes } from "react-router-dom";

const LOGISTIQUE_ROUTE_PERMS = [
  "logistics.inventory",
  "logistics.po_approve_manager",
  "logistics.po_approve_dg",
  "logistics.po_release_finance",
  "logistics.po_release_accounting",
] as const;

export default function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route path="/accepter-invitation" element={<AcceptInvitePage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
                   <Route
            index
            element={
              <RequireSessionAccess>
                <Dashboard />
              </RequireSessionAccess>
            }
          />
          <Route
            path="finance"
            element={
              <RequirePermission anyOf={[...mainNavRequiredPermissions("/finance")]}>
                <Finance />
              </RequirePermission>
            }
          />
          <Route
            path="rapports"
            element={
              <RequirePermission anyOf={[...mainNavRequiredPermissions("/rapports")]}>
                <Reports />
              </RequirePermission>
            }
          />
          <Route
            path="bungalows"
            element={
              <RequirePermission anyOf={HEBERGEMENT_ROUTE_PERMS["/bungalows"]}>
                <Bungalows />
              </RequirePermission>
            }
          />
          <Route
            path="menage"
            element={
              <RequirePermission anyOf={HEBERGEMENT_ROUTE_PERMS["/menage"]}>
                <Housekeeping />
              </RequirePermission>
            }
          />
          <Route
            path="maintenance"
            element={
              <RequirePermission anyOf={HEBERGEMENT_ROUTE_PERMS["/maintenance"]}>
                <Maintenance />
              </RequirePermission>
            }
          />
          <Route
            path="bungalows/:id"
            element={
              <RequirePermission anyOf={[...HEBERGEMENT_ROUTE_PERMS["/bungalows"], ...HEBERGEMENT_ROUTE_PERMS["/menage"]]}>
                <BungalowDetail />
              </RequirePermission>
            }
          />
          <Route
            path="reservations"
            element={
              <RequirePermission anyOf={HEBERGEMENT_ROUTE_PERMS["/reservations"]}>
                <Reservations />
              </RequirePermission>
            }
          />
          <Route
            path="accueil-sejour"
            element={
              <RequirePermission anyOf={HEBERGEMENT_ROUTE_PERMS["/accueil-sejour"]}>
                <AccueilSejour />
              </RequirePermission>
            }
          />
          <Route
            path="paiement"
            element={
              <RequirePermission anyOf={[...mainNavRequiredPermissions("/paiement")]}>
                <Payments variant="finance" />
              </RequirePermission>
            }
          />
          <Route
            path="caisse-reception"
            element={
              <RequirePermission anyOf={[...HEBERGEMENT_ROUTE_PERMS["/caisse-reception"]]}>
                <Payments variant="reception" />
              </RequirePermission>
            }
          />
          <Route
            path="comptoir"
            element={
              <RequirePermission anyOf={[...mainNavRequiredPermissions("/comptoir")]}>
                <CounterSales />
              </RequirePermission>
            }
          />
          <Route
            path="tresorerie"
            element={
              <RequirePermission anyOf={[...mainNavRequiredPermissions("/tresorerie")]}>
                <Treasury />
              </RequirePermission>
            }
          />
          <Route
            path="livre-caisse"
            element={
              <RequirePermission anyOf={[...mainNavRequiredPermissions("/livre-caisse")]}>
                <CashBook />
              </RequirePermission>
            }
          />
          <Route
            path="clients"
            element={
              <RequirePermission
                anyOf={["directory.clients", "lodging.reservations", "lodging.stay_reception", "lodging.reception_cash"]}
              >
                <Clients />
              </RequirePermission>
            }
          />
          <Route
            path="clients/:id"
            element={
              <RequirePermission
                anyOf={["directory.clients", "lodging.reservations", "lodging.stay_reception", "lodging.reception_cash"]}
              >
                <ClientDetail />
              </RequirePermission>
            }
          />
          <Route
            path="facturation"
            element={
              <RequirePermission anyOf={[...mainNavRequiredPermissions("/facturation")]}>
                <Invoices />
              </RequirePermission>
            }
          />
          <Route
            path="cloture-audit"
            element={
              <RequirePermission anyOf={[...mainNavRequiredPermissions("/cloture-audit")]}>
                <NightAudit />
              </RequirePermission>
            }
          />
          <Route path="stocks" element={<StocksLegacyRedirect />} />
          <Route path="logistique" element={<LogistiqueIndexRedirect />} />
          <Route
            path="logistique/:section"
            element={
              <RequirePermission anyOf={[...LOGISTIQUE_ROUTE_PERMS]}>
                <Stocks />
              </RequirePermission>
            }
          />
          <Route
            path="parametres"
            element={
              <RequireAppAdmin>
                <Settings />
              </RequireAppAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
