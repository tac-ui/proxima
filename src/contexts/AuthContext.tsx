"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { triggerSSEConnect } from "./ApiContext";

interface AuthUser {
  userId: number;
  username: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  needsSetup: boolean;
  loading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  needsSetup: false,
  loading: true,
  isAdmin: false,
  isManager: false,
  login: async () => {},
  setup: async () => {},
  logout: () => {},
});

const TOKEN_KEY = "proxima_auth_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check setup status and auto-login on mount
  useEffect(() => {
    const init = async () => {
      try {
        const checkRes = await api.checkNeedSetup();
        if (checkRes.ok && checkRes.data) {
          setNeedsSetup(true);
          setLoading(false);
          return;
        }

        const savedToken = localStorage.getItem(TOKEN_KEY);
        if (!savedToken) {
          setLoading(false);
          return;
        }

        const verifyRes = await api.verify();
        if (verifyRes.ok && verifyRes.data) {
          setUser({ userId: verifyRes.data.userId, username: verifyRes.data.username, role: verifyRes.data.role });
          setToken(savedToken);
          triggerSSEConnect();
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      } catch {
        // Server not reachable
      }
      setLoading(false);
    };
    init();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    if (res.ok && res.data) {
      const newToken = res.data.token;
      localStorage.setItem(TOKEN_KEY, newToken);
      setToken(newToken);

      const verifyRes = await api.verify();
      if (verifyRes.ok && verifyRes.data) {
        setUser({ userId: verifyRes.data.userId, username: verifyRes.data.username, role: verifyRes.data.role });
      }
      triggerSSEConnect();
    } else {
      throw new Error(res.error ?? "Login failed");
    }
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const res = await api.setup(username, password);
    if (res.ok && res.data) {
      const newToken = res.data.token;
      localStorage.setItem(TOKEN_KEY, newToken);
      setToken(newToken);
      setNeedsSetup(false);

      const verifyRes = await api.verify();
      if (verifyRes.ok && verifyRes.data) {
        setUser({ userId: verifyRes.data.userId, username: verifyRes.data.username, role: verifyRes.data.role });
      }
      triggerSSEConnect();
    } else {
      throw new Error(res.error ?? "Setup failed");
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setToken(null);
  }, []);

  const isAdmin = user?.role === "admin";
  const isManager = user?.role === "admin" || user?.role === "manager";

  return (
    <AuthContext.Provider value={{ user, token, needsSetup, loading, isAdmin, isManager, login, setup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
