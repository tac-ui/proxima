"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useApiContext } from "@/contexts/ApiContext";
import { TacLogo } from "@tac-ui/icon";
import { Indicator } from "@tac-ui/web";
import { useBranding } from "@/contexts/BrandingContext";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, needsSetup, loading } = useAuth();
  const { connected } = useApiContext();
  const { appName, logoUrl } = useBranding();
  const router = useRouter();

  // Track branding changes for crossfade
  const [displayLogo, setDisplayLogo] = useState(logoUrl);
  const [displayName, setDisplayName] = useState(appName);
  const [fading, setFading] = useState(false);
  const prevLogoRef = useRef(logoUrl);
  const prevNameRef = useRef(appName);

  useEffect(() => {
    const logoChanged = prevLogoRef.current !== logoUrl;
    const nameChanged = prevNameRef.current !== appName;

    if (logoChanged || nameChanged) {
      setFading(true);
      const timer = setTimeout(() => {
        setDisplayLogo(logoUrl);
        setDisplayName(appName);
        setFading(false);
      }, 200);
      prevLogoRef.current = logoUrl;
      prevNameRef.current = appName;
      return () => clearTimeout(timer);
    }
  }, [logoUrl, appName]);

  useEffect(() => {
    if (!loading && (!user || needsSetup)) {
      router.replace("/login");
    }
  }, [user, needsSetup, loading, router]);

  if (loading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-background">
        {/* Background pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,var(--point)/5%,transparent_70%)]" />

        <div className="relative flex flex-col items-center">
          {/* Logo */}
          <div className="relative mb-8">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center bg-surface border border-border shadow-sm transition-opacity duration-300 ease-in-out"
              style={{ opacity: fading ? 0 : 1 }}
            >
              {displayLogo ? (
                <img src={displayLogo} alt={displayName} className="w-14 h-14 rounded-xl object-cover" />
              ) : (
                <TacLogo width={40} height={40} className="text-point" />
              )}
            </div>
            <div className="absolute -inset-4 rounded-3xl bg-point/8 blur-2xl -z-10 animate-pulse" />
          </div>

          {/* App name */}
          <h1
            className="text-xl font-bold tracking-tight mb-1 transition-opacity duration-300 ease-in-out"
            style={{ opacity: fading ? 0 : 1 }}
          >
            {displayName}
          </h1>
          <p className="text-sm text-muted-foreground mb-8">
            {!connected ? "Connecting to server..." : "Loading..."}
          </p>

          {/* Loading indicator */}
          <div className="w-56">
            <Indicator />
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
