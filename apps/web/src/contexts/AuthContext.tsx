import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getMe, login as loginRequest, type CurrentUser } from "../api/auth";
import { setAuthToken, setTokenRenewedHandler, setUnauthorizedHandler } from "../api/client";

export const TOKEN_STORAGE_KEY = "hrpayroll.authToken";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

interface AuthState {
  status: AuthStatus;
  user: CurrentUser | null;
  token: string | null;
}

export interface AuthContextValue extends AuthState {
  /** Rejects with the ApiError when sign-in fails; the caller shows the message. */
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const SIGNED_OUT: AuthState = { status: "signedOut", user: null, token: null };

// localStorage keeps the user signed in across app restarts (installed phone app); it can throw (blocked storage, private modes), so every access is guarded.
function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // The in-memory token still works for this page load.
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const stored = readStoredToken();
    return stored ? { status: "loading", user: null, token: stored } : SIGNED_OUT;
  });

  // The token this tab signed in with, so a rejected one does not remove a newer one that another tab has stored.
  const tokenRef = useRef(state.token);

  const clearSession = useCallback(() => {
    setAuthToken(null);
    storeToken(null);
    tokenRef.current = null;
    setState(SIGNED_OUT);
  }, []);

  const expireSession = useCallback(() => {
    const stored = readStoredToken();
    if (stored === null || stored === tokenRef.current) {
      clearSession();
      return;
    }
    setAuthToken(null);
    tokenRef.current = null;
    setState(SIGNED_OUT);
  }, [clearSession]);

  useEffect(() => {
    setUnauthorizedHandler(expireSession);
    setTokenRenewedHandler((token) => {
      storeToken(token);
      tokenRef.current = token;
      setState((current) => (current.status === "signedIn" ? { ...current, token } : current));
    });
    return () => {
      setUnauthorizedHandler(null);
      setTokenRenewedHandler(null);
    };
  }, [expireSession]);

  // Restore: a token from a previous page load is only trusted once the server accepts it.
  useEffect(() => {
    const stored = readStoredToken();
    if (!stored) {
      return;
    }
    let cancelled = false;
    setAuthToken(stored);
    getMe()
      .then((user) => {
        if (!cancelled) {
          setState({ status: "signedIn", user, token: stored });
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearSession();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await loginRequest(username, password);
    setAuthToken(response.token);
    storeToken(response.token);
    tokenRef.current = response.token;
    setState({ status: "signedIn", user: response.user, token: response.token });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout: clearSession }),
    [state, login, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider.");
  }
  return context;
}
