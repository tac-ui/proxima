"use client";

import React, { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useApiContext } from "@/contexts/ApiContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardContent,
  Switch,
  Input,
  Button,
  useTacTheme,
  useToast,
  pageEntrance,
} from "@tac-ui/web";
import { Sun, Moon, Monitor, Wifi, Info, Palette, Upload, Trash2 } from "@tac-ui/icon";
import packageJson from "../../../../package.json";

export default function SettingsPage() {
  const { mode, preference, setPreference } = useTacTheme();
  const { connected } = useApiContext();
  const { user, isManager } = useAuth();
  const { appName, logoUrl, faviconUrl, showLogo, showAppName, ogTitle, ogDescription, refresh } = useBranding();
  const { toast } = useToast();

  const [brandAppName, setBrandAppName] = useState(appName);
  const [brandLogoUrl, setBrandLogoUrl] = useState(logoUrl);
  const [brandFaviconUrl, setBrandFaviconUrl] = useState(faviconUrl);
  const [brandShowLogo, setBrandShowLogo] = useState(showLogo);
  const [brandShowAppName, setBrandShowAppName] = useState(showAppName);
  const [brandOgTitle, setBrandOgTitle] = useState(ogTitle);
  const [brandOgDescription, setBrandOgDescription] = useState(ogDescription);
  const [saving, setSaving] = useState(false);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [previewLogoUrl, setPreviewLogoUrl] = useState("");
  const [pendingLogoDelete, setPendingLogoDelete] = useState(false);
  const [pendingFaviconFile, setPendingFaviconFile] = useState<File | null>(null);
  const [previewFaviconUrl, setPreviewFaviconUrl] = useState("");
  const [pendingFaviconDelete, setPendingFaviconDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBrandAppName(appName);
    setBrandLogoUrl(logoUrl);
    setBrandFaviconUrl(faviconUrl);
    setBrandShowLogo(showLogo);
    setBrandShowAppName(showAppName);
    setBrandOgTitle(ogTitle);
    setBrandOgDescription(ogDescription);
  }, [appName, logoUrl, faviconUrl, showLogo, showAppName, ogTitle, ogDescription]);

  useEffect(() => {
    return () => {
      if (previewLogoUrl) URL.revokeObjectURL(previewLogoUrl);
      if (previewFaviconUrl) URL.revokeObjectURL(previewFaviconUrl);
    };
  }, [previewLogoUrl, previewFaviconUrl]);

  const handleSaveBranding = async () => {
    setSaving(true);
    try {
      if (pendingLogoDelete) {
        const delRes = await api.deleteLogo();
        if (!delRes.ok) {
          toast(delRes.error ?? "Failed to remove logo", { variant: "error" });
          return;
        }
      }
      if (pendingFaviconDelete) {
        const delRes = await api.deleteFavicon();
        if (!delRes.ok) {
          toast(delRes.error ?? "Failed to remove favicon", { variant: "error" });
          return;
        }
      }
      let effectiveLogoUrl = brandLogoUrl;
      if (pendingLogoFile) {
        const upRes = await api.uploadLogo(pendingLogoFile);
        if (!upRes.ok) {
          toast(upRes.error ?? "Logo upload failed", { variant: "error" });
          return;
        }
        if (upRes.data?.logoUrl) {
          effectiveLogoUrl = upRes.data.logoUrl;
          setBrandLogoUrl(effectiveLogoUrl);
        }
      }
      let effectiveFaviconUrl = brandFaviconUrl;
      if (pendingFaviconFile) {
        const upRes = await api.uploadFavicon(pendingFaviconFile);
        if (!upRes.ok) {
          toast(upRes.error ?? "Favicon upload failed", { variant: "error" });
          return;
        }
        if (upRes.data?.faviconUrl) {
          effectiveFaviconUrl = upRes.data.faviconUrl;
          setBrandFaviconUrl(effectiveFaviconUrl);
        }
      }
      const res = await api.updateBranding({ appName: brandAppName, logoUrl: effectiveLogoUrl, faviconUrl: effectiveFaviconUrl, showLogo: brandShowLogo, showAppName: brandShowAppName, ogTitle: brandOgTitle, ogDescription: brandOgDescription });
      if (res.ok) {
        await refresh();
        toast("Branding updated", { variant: "success" });
      } else {
        toast(res.error ?? "Failed to save", { variant: "error" });
      }
    } catch {
      toast("Failed to save branding", { variant: "error" });
    } finally {
      setPendingLogoFile(null);
      if (previewLogoUrl) URL.revokeObjectURL(previewLogoUrl);
      setPreviewLogoUrl("");
      setPendingLogoDelete(false);
      setPendingFaviconFile(null);
      if (previewFaviconUrl) URL.revokeObjectURL(previewFaviconUrl);
      setPreviewFaviconUrl("");
      setPendingFaviconDelete(false);
      setSaving(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewLogoUrl) URL.revokeObjectURL(previewLogoUrl);
    setPendingLogoFile(file);
    setPreviewLogoUrl(URL.createObjectURL(file));
    setPendingLogoDelete(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleLogoDelete = () => {
    if (previewLogoUrl) URL.revokeObjectURL(previewLogoUrl);
    setPendingLogoFile(null);
    setPreviewLogoUrl("");
    setBrandLogoUrl("");
    setPendingLogoDelete(true);
  };

  const applyFaviconRadius = (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const size = Math.min(img.width, img.height);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        const radius = size * 0.2;
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(size - radius, 0);
        ctx.quadraticCurveTo(size, 0, size, radius);
        ctx.lineTo(size, size - radius);
        ctx.quadraticCurveTo(size, size, size - radius, size);
        ctx.lineTo(radius, size);
        ctx.quadraticCurveTo(0, size, 0, size - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        ctx.clip();
        const scale = size / Math.min(img.width, img.height);
        const dx = (size - img.width * scale) / 2;
        const dy = (size - img.height * scale) / 2;
        ctx.drawImage(img, dx, dy, img.width * scale, img.height * scale);
        canvas.toBlob((blob) => {
          if (blob) resolve(new File([blob], file.name.replace(/\.\w+$/, ".png"), { type: "image/png" }));
          else resolve(file);
        }, "image/png");
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  };

  const handleFaviconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewFaviconUrl) URL.revokeObjectURL(previewFaviconUrl);
    const rounded = await applyFaviconRadius(file);
    setPendingFaviconFile(rounded);
    setPreviewFaviconUrl(URL.createObjectURL(rounded));
    setPendingFaviconDelete(false);
    if (faviconInputRef.current) faviconInputRef.current.value = "";
  };

  const handleFaviconDelete = () => {
    if (previewFaviconUrl) URL.revokeObjectURL(previewFaviconUrl);
    setPendingFaviconFile(null);
    setPreviewFaviconUrl("");
    setBrandFaviconUrl("");
    setPendingFaviconDelete(true);
  };

  return (
    <motion.div
      className="max-w-screen-md mx-auto space-y-6"
      {...pageEntrance}
    >
      {/* Appearance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
              {mode === "dark" ? <Moon size={18} className="text-point" /> : <Sun size={18} className="text-point" />}
            </div>
            <div>
              <h2 className="text-sm font-semibold">Appearance</h2>
              <p className="text-xs text-muted-foreground">Customize the look and feel</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-sm font-medium">Theme</p>
            <p className="text-xs text-muted-foreground">Choose your preferred appearance</p>
            <div className="flex gap-2 pt-1">
              {([
                { value: "light" as const, icon: <Sun size={16} />, label: "Light" },
                { value: "dark" as const, icon: <Moon size={16} />, label: "Dark" },
                { value: "system" as const, icon: <Monitor size={16} />, label: "System" },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPreference(opt.value)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    preference === opt.value
                      ? "border-point bg-point/10 text-point"
                      : "border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-hover"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connection */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-success/15 flex items-center justify-center">
              <Wifi size={18} className="text-success" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Connection</h2>
              <p className="text-xs text-muted-foreground">Backend connectivity status</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">API Status</p>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-error"}`} />
                <span className="text-sm font-medium">{connected ? "Connected" : "Disconnected"}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Logged in as</p>
              <span className="text-sm font-medium">{user?.username ?? "—"}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Branding (manager+) */}
      {isManager && <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center">
              <Palette size={18} className="text-warning" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Branding</h2>
              <p className="text-xs text-muted-foreground">Customize app name and logo</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Input
              label="App Name"
              value={brandAppName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBrandAppName(e.target.value)}
              placeholder="Proxima"
            />
            <div>
              <p className="text-sm font-medium mb-2">Logo</p>
              <div className="flex items-center gap-4">
                {!pendingLogoDelete && (previewLogoUrl || logoUrl) ? (
                  <img
                    src={previewLogoUrl || `${logoUrl}?t=${Date.now()}`}
                    alt="Logo"
                    className="w-12 h-12 rounded-lg object-cover border border-border"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center border border-dashed border-border">
                    <Upload size={16} className="text-muted-foreground" />
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    leftIcon={<Upload size={14} />}
                  >
                    Upload
                  </Button>
                  {!pendingLogoDelete && (previewLogoUrl || logoUrl) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleLogoDelete}
                      leftIcon={<Trash2 size={14} />}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">PNG, JPEG, GIF, WebP. Max 2MB.</p>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Favicon</p>
              <div className="flex items-center gap-4">
                {!pendingFaviconDelete && (previewFaviconUrl || faviconUrl) ? (
                  <img
                    src={previewFaviconUrl || `${faviconUrl}?t=${Date.now()}`}
                    alt="Favicon"
                    className="w-8 h-8 rounded object-cover border border-border"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center border border-dashed border-border">
                    <Upload size={12} className="text-muted-foreground" />
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    ref={faviconInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/x-icon,image/vnd.microsoft.icon"
                    className="hidden"
                    onChange={handleFaviconUpload}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => faviconInputRef.current?.click()}
                    leftIcon={<Upload size={14} />}
                  >
                    Upload
                  </Button>
                  {!pendingFaviconDelete && (previewFaviconUrl || faviconUrl) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleFaviconDelete}
                      leftIcon={<Trash2 size={14} />}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">PNG, ICO, WebP. Max 1MB. Used as the browser tab icon.</p>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div>
                <p className="text-sm font-medium">Show Logo in Header</p>
                <p className="text-xs text-muted-foreground">Display logo on the header bar</p>
              </div>
              <Switch
                checked={brandShowLogo}
                onChange={() => setBrandShowLogo(prev => !prev)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Show App Name in Header</p>
                <p className="text-xs text-muted-foreground">Display app name on the header bar</p>
              </div>
              <Switch
                checked={brandShowAppName}
                onChange={() => setBrandShowAppName(prev => !prev)}
              />
            </div>
            <div className="border-t border-border pt-4 mt-2">
              <p className="text-sm font-medium mb-1">Open Graph</p>
              <p className="text-xs text-muted-foreground mb-3">Customize how your app appears when shared on social media</p>
              <div className="space-y-3">
                <Input
                  label="OG Title"
                  value={brandOgTitle}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBrandOgTitle(e.target.value)}
                  placeholder={brandAppName || "Proxima"}
                />
                <div>
                  <label className="text-sm font-medium block mb-1.5">OG Description</label>
                  <textarea
                    value={brandOgDescription}
                    onChange={(e) => setBrandOgDescription(e.target.value)}
                    placeholder={`${brandAppName || "Proxima"} — All-in-one server management panel`}
                    rows={2}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                disabled={saving || (brandAppName === appName && brandShowLogo === showLogo && brandShowAppName === showAppName && brandOgTitle === ogTitle && brandOgDescription === ogDescription && !pendingLogoFile && !pendingLogoDelete && !pendingFaviconFile && !pendingFaviconDelete)}
                onClick={handleSaveBranding}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>}

      {/* About */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-info/15 flex items-center justify-center">
              <Info size={18} className="text-info" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">About</h2>
              <p className="text-xs text-muted-foreground">Application information</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Application</p>
              <span className="text-sm font-medium">{appName}</span>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Version</p>
              <span className="text-sm font-medium">v{packageJson.version}</span>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Stack</p>
              <span className="text-sm font-medium">Next.js · Docker</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
