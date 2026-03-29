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
  SegmentController,
  useTacTheme,
  useToast,
  pageEntrance,
} from "@tac-ui/web";
import { Sun, Moon, Wifi, Info, Palette, Upload, Trash2, Bell, Plus, Send } from "@tac-ui/icon";
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

  // Notification state
  const [notifChannels, setNotifChannels] = useState<{ id: number; type: string; name: string; config: string; enabled: boolean; createdAt: string }[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelType, setNewChannelType] = useState<"slack" | "telegram">("slack");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelWebhookUrl, setNewChannelWebhookUrl] = useState("");
  const [newChannelBotToken, setNewChannelBotToken] = useState("");
  const [newChannelChatId, setNewChannelChatId] = useState("");
  const [addingChannel, setAddingChannel] = useState(false);
  const [testingChannelId, setTestingChannelId] = useState<number | null>(null);

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

  // Load notification channels
  const loadNotifChannels = async () => {
    setNotifLoading(true);
    try {
      const res = await api.getNotificationChannels();
      if (res.ok && res.data) setNotifChannels(res.data);
    } catch { /* ignore */ }
    setNotifLoading(false);
  };

  useEffect(() => {
    if (isManager) loadNotifChannels();
  }, [isManager]);

  const handleAddChannel = async () => {
    setAddingChannel(true);
    try {
      const config: Record<string, string> = newChannelType === "slack"
        ? { webhookUrl: newChannelWebhookUrl }
        : { botToken: newChannelBotToken, chatId: newChannelChatId };
      const res = await api.addNotificationChannel({ type: newChannelType, name: newChannelName, config });
      if (res.ok) {
        toast("Channel added", { variant: "success" });
        setShowAddChannel(false);
        setNewChannelName("");
        setNewChannelWebhookUrl("");
        setNewChannelBotToken("");
        setNewChannelChatId("");
        await loadNotifChannels();
      } else {
        toast(res.error ?? "Failed to add channel", { variant: "error" });
      }
    } catch {
      toast("Failed to add channel", { variant: "error" });
    }
    setAddingChannel(false);
  };

  const handleToggleChannel = async (id: number, enabled: boolean) => {
    const res = await api.updateNotificationChannel(id, { enabled });
    if (res.ok) {
      setNotifChannels(prev => prev.map(ch => ch.id === id ? { ...ch, enabled } : ch));
    } else {
      toast(res.error ?? "Failed to update", { variant: "error" });
    }
  };

  const handleDeleteChannel = async (id: number) => {
    const res = await api.deleteNotificationChannel(id);
    if (res.ok) {
      setNotifChannels(prev => prev.filter(ch => ch.id !== id));
      toast("Channel deleted", { variant: "success" });
    } else {
      toast(res.error ?? "Failed to delete", { variant: "error" });
    }
  };

  const handleTestChannel = async (id: number) => {
    setTestingChannelId(id);
    try {
      const res = await api.testNotificationChannel(id);
      if (res.ok) {
        toast("Test notification sent", { variant: "success" });
      } else {
        toast(res.error ?? "Test failed", { variant: "error" });
      }
    } catch {
      toast("Test failed", { variant: "error" });
    }
    setTestingChannelId(null);
  };

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
            <div className="pt-1">
              <SegmentController
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ]}
                value={preference}
                onChange={(v) => setPreference(v as "light" | "dark" | "system")}
                size="sm"
              />
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

      {/* Notifications (manager+) */}
      {isManager && <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
              <Bell size={18} className="text-point" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold">Notifications</h2>
              <p className="text-xs text-muted-foreground">Configure Slack and Telegram notification channels</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setShowAddChannel(v => !v)} leftIcon={<Plus size={14} />}>
              Add Channel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Add channel form */}
            {showAddChannel && (
              <div className="border border-border rounded-lg p-4 space-y-3">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Channel Type</p>
                  <SegmentController
                    options={[
                      { value: "slack", label: "Slack" },
                      { value: "telegram", label: "Telegram" },
                    ]}
                    value={newChannelType}
                    onChange={(v) => setNewChannelType(v as "slack" | "telegram")}
                    size="sm"
                  />
                </div>
                <Input
                  label="Channel Name"
                  value={newChannelName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewChannelName(e.target.value)}
                  placeholder="e.g. Team Alerts"
                />
                {newChannelType === "slack" ? (
                  <Input
                    label="Webhook URL"
                    value={newChannelWebhookUrl}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewChannelWebhookUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/..."
                  />
                ) : (
                  <>
                    <Input
                      label="Bot Token"
                      value={newChannelBotToken}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewChannelBotToken(e.target.value)}
                      placeholder="123456:ABC-DEF..."
                    />
                    <Input
                      label="Chat ID"
                      value={newChannelChatId}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewChannelChatId(e.target.value)}
                      placeholder="-1001234567890"
                    />
                  </>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowAddChannel(false)}>Cancel</Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={addingChannel || !newChannelName || (newChannelType === "slack" ? !newChannelWebhookUrl : (!newChannelBotToken || !newChannelChatId))}
                    onClick={handleAddChannel}
                  >
                    {addingChannel ? "Adding..." : "Add"}
                  </Button>
                </div>
              </div>
            )}

            {/* Channel list */}
            {notifLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : notifChannels.length === 0 && !showAddChannel ? (
              <p className="text-sm text-muted-foreground">No notification channels configured.</p>
            ) : (
              notifChannels.map((ch) => (
                <div key={ch.id} className="flex items-center justify-between border border-border rounded-lg p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted">{ch.type === "slack" ? "Slack" : "Telegram"}</span>
                    <span className="text-sm font-medium truncate">{ch.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={testingChannelId === ch.id}
                      onClick={() => handleTestChannel(ch.id)}
                      leftIcon={<Send size={14} />}
                    >
                      {testingChannelId === ch.id ? "Sending..." : "Test"}
                    </Button>
                    <Switch
                      checked={ch.enabled}
                      onChange={() => handleToggleChannel(ch.id, !ch.enabled)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteChannel(ch.id)}
                      leftIcon={<Trash2 size={14} />}
                    >
                    </Button>
                  </div>
                </div>
              ))
            )}
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
