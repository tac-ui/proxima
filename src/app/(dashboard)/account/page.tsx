"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardContent,
  Input,
  Button,
  Badge,
  useToast,
  pageEntrance,
} from "@tac-ui/web";
import { Key, User } from "@tac-ui/icon";

export default function AccountPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast("Passwords do not match", { variant: "error" });
      return;
    }
    setPwSaving(true);
    try {
      const res = await api.changePassword(currentPassword, newPassword);
      if (res.ok) {
        toast("Password changed successfully", { variant: "success" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        toast(res.error ?? "Failed to change password", { variant: "error" });
      }
    } catch {
      toast("Failed to change password", { variant: "error" });
    } finally {
      setPwSaving(false);
    }
  };

  const roleBadgeVariant = (role: string): "default" | "success" | "secondary" => {
    if (role === "admin") return "default";
    if (role === "manager") return "success";
    return "secondary";
  };

  return (
    <motion.div
      className="max-w-screen-md mx-auto space-y-6"
      {...pageEntrance}
    >
      {/* Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
              <User size={18} className="text-point" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Profile</h2>
              <p className="text-xs text-muted-foreground">Your account information</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Username</p>
              <span className="text-sm font-medium">{user?.username ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Role</p>
              {user?.role && (
                <Badge variant={roleBadgeVariant(user.role)}>
                  {user.role}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center">
              <Key size={18} className="text-warning" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Change Password</h2>
              <p className="text-xs text-muted-foreground">Update your password</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Input
              label="Current Password"
              type="password"
              value={currentPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
            <Input
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
            />
            <Input
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              error={confirmPassword !== "" && newPassword !== confirmPassword}
              errorMessage="Passwords do not match"
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                disabled={pwSaving || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword}
                onClick={handleChangePassword}
              >
                {pwSaving ? "Saving..." : "Change Password"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
