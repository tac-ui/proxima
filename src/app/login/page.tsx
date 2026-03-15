"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useApiContext } from "@/contexts/ApiContext";
import {
  Card,
  CardContent,
  Input,
  Button,
  Alert,
  AlertDescription,
  Indicator,
} from "@tac-ui/web";
import { TacLogo } from "@tac-ui/icon";
import { useBranding } from "@/contexts/BrandingContext";

export default function LoginPage() {
  const router = useRouter();
  const { user, needsSetup, loading: authLoading, login, setup } = useAuth();
  const { connected } = useApiContext();
  const { appName, logoUrl } = useBranding();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/");
    }
  }, [user, authLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (needsSetup) {
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }
      if (!/[0-9]/.test(password)) {
        setError("Password must contain a number");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (needsSetup) {
        await setup(username, password);
      } else {
        await login(username, password);
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-full">
        <div className="relative flex flex-col items-center">
          <div className="relative mb-8">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center bg-surface border border-border shadow-sm">
              {logoUrl ? (
                <img src={logoUrl} alt={appName} className="w-14 h-14 rounded-xl object-cover" />
              ) : (
                <TacLogo width={40} height={40} className="text-point" />
              )}
            </div>
            <div className="absolute -inset-4 rounded-3xl bg-point/8 blur-2xl -z-10 animate-pulse" />
          </div>
          <h1 className="text-xl font-bold tracking-tight mb-1">{appName}</h1>
          <p className="text-sm text-muted-foreground mb-8">Loading...</p>
          <div className="w-56">
            <Indicator />
          </div>
        </div>
      </div>
    );
  }

  if (user) return null;

  return (
    <div className="w-full max-w-96">
      {/* Logo / Title */}
      <div className="text-center mb-8">
        <div className="w-12 h-12 mx-auto mb-4">
          {logoUrl ? (
            <img src={logoUrl} alt={appName} className="w-12 h-12 rounded-xl object-cover" />
          ) : (
            <TacLogo width={48} height={48} className="text-point" />
          )}
        </div>
        <h1 className="text-xl font-semibold">{appName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {needsSetup ? "Create your admin account to get started" : "Sign in to your account"}
        </p>
      </div>

      {/* Form Card */}
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {needsSetup && (
              <Alert variant="info">
                <AlertDescription>First time setup — create an admin account</AlertDescription>
              </Alert>
            )}

            <Input
              label="Username"
              type="text"
              value={username}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              required
              disabled={!connected}
            />

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              placeholder={needsSetup ? "Min 8 chars + number" : ""}
              autoComplete={needsSetup ? "new-password" : "current-password"}
              required
              minLength={needsSetup ? 8 : undefined}
              disabled={!connected}
            />

            {error && (
              <Alert variant="error" dismissible onDismiss={() => setError("")}>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={submitting || !connected}
              className="w-full mt-1"
            >
              {submitting ? "Signing in..." : needsSetup ? "Create Account" : "Sign In"}
            </Button>
          </form>

          {!connected && (
            <div className="mt-4 flex items-center gap-2.5 text-sm text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-error animate-pulse" />
              Connecting to server...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
