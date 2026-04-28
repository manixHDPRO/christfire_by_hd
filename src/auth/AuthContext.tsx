import { apiGetMe, apiLogin, apiLogout, apiRefreshSession } from "@/lib/api";
import type { AuthUser } from "@/types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import type { LoginFailureCode } from "./loginCodes";

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<LoginFailureCode | null>;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const lastBackgroundMeRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const me = await apiGetMe();
        if (!cancelled) setUser(me);
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Recharge les droits affichés (matrice / rôle) sans reconnexion — uniquement si une session existe. */
  useEffect(() => {
    if (!ready || !user) return;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      const t = Date.now();
      if (t - lastBackgroundMeRef.current < 4000) return;
      lastBackgroundMeRef.current = t;
      const me = await apiRefreshSession();
      if (me === null) setUser(null);
      else if (me !== undefined) setUser(me);
    };
    const onVis = () => {
      void pull();
    };
    document.addEventListener("visibilitychange", onVis);
    const id = window.setInterval(() => void pull(), 90_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(id);
    };
  }, [ready, user?.id]);

  const refreshUser = useCallback(async () => {
    const me = await apiRefreshSession();
    if (me === null) setUser(null);
    else if (me !== undefined) setUser(me);
  }, []);

  const login = useCallback(
    async (email: string, password: string, totpCode?: string): Promise<LoginFailureCode | null> => {
      const res = await apiLogin(email, password, totpCode);
      if (!res.ok) return res.code;
      setUser(res.user);
      return null;
    },
    [],
  );

  const logout = useCallback(() => {
    void apiLogout();
    setUser(null);
    navigate("/connexion", { replace: true });
  }, [navigate]);

  const value = useMemo(
    () => ({
      user,
      ready,
      login,
      logout,
      refreshUser,
    }),
    [user, ready, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans un AuthProvider");
  return ctx;
}
