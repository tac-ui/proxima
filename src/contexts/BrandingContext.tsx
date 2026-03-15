"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

interface BrandingState {
  appName: string;
  logoUrl: string;
  faviconUrl: string;
  showLogo: boolean;
  showAppName: boolean;
  ogTitle: string;
  ogDescription: string;
  loading: boolean;
  refresh: () => Promise<void>;
}

const BrandingContext = createContext<BrandingState>({
  appName: "Proxima",
  logoUrl: "",
  faviconUrl: "",
  showLogo: true,
  showAppName: true,
  ogTitle: "",
  ogDescription: "",
  loading: true,
  refresh: async () => {},
});

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [appName, setAppName] = useState("Proxima");
  const [logoUrl, setLogoUrl] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [showLogo, setShowLogo] = useState(true);
  const [showAppName, setShowAppName] = useState(true);
  const [ogTitle, setOgTitle] = useState("");
  const [ogDescription, setOgDescription] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getBranding();
      if (res.ok && res.data) {
        setAppName(res.data.appName || "Proxima");
        setLogoUrl(res.data.logoUrl || "");
        setFaviconUrl(res.data.faviconUrl || "");
        setShowLogo(res.data.showLogo ?? true);
        setShowAppName(res.data.showAppName ?? true);
        setOgTitle(res.data.ogTitle || "");
        setOgDescription(res.data.ogDescription || "");
      }
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <BrandingContext.Provider value={{ appName, logoUrl, faviconUrl, showLogo, showAppName, ogTitle, ogDescription, loading, refresh }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
