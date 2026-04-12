"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { api } from "@/lib/api";
import type { User, UserRole } from "@/types";
import {
  Card,
  CardHeader,
  CardContent,
  Input,
  Button,
  Badge,
  Select,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  Skeleton,
  useToast,
  Indicator,
  pageEntrance,
} from "@tac-ui/web";
import { Users, UserPlus, Trash2, ShieldAlert } from "@tac-ui/icon";

export default function UsersPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [users, setUsers] = useState<User[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("viewer");
  const [creating, setCreating] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const res = await api.getUsers();
      if (res.ok && res.data) {
        setUsers(res.data);
        setUsersLoaded(true);
      }
    } catch {
      toast("Failed to load users", { variant: "error" });
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin, loadUsers]);

  const handleCreateUser = async () => {
    setCreating(true);
    try {
      const res = await api.createUser(newUsername, newUserPassword, newUserRole);
      if (res.ok) {
        toast("User created", { variant: "success" });
        setShowCreateUser(false);
        setNewUsername("");
        setNewUserPassword("");
        setNewUserRole("viewer");
        loadUsers();
      } else {
        toast(res.error ?? "Failed to create user", { variant: "error" });
      }
    } catch {
      toast("Failed to create user", { variant: "error" });
    } finally {
      setCreating(false);
    }
  };

  const handleChangeRole = async (userId: number, role: UserRole) => {
    try {
      const res = await api.updateUserRole(userId, role);
      if (res.ok) {
        toast("Role updated", { variant: "success" });
        loadUsers();
      } else {
        toast(res.error ?? "Failed to update role", { variant: "error" });
      }
    } catch {
      toast("Failed to update role", { variant: "error" });
    }
  };

  const handleDeleteUser = async (u: User) => {
    const ok = await confirm({
      title: "Delete User",
      message: `Are you sure you want to delete "${u.username}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      const res = await api.deleteUser(u.id);
      if (res.ok) {
        toast("User deleted", { variant: "success" });
        loadUsers();
      } else {
        toast(res.error ?? "Failed to delete user", { variant: "error" });
      }
    } catch {
      toast("Failed to delete user", { variant: "error" });
    }
  };

  const roleBadgeVariant = (role: string): "default" | "success" | "secondary" => {
    if (role === "admin") return "default";
    if (role === "manager") return "success";
    return "secondary";
  };

  if (!isAdmin) {
    return (
      <motion.div
        className="max-w-screen-md mx-auto"
        {...pageEntrance}
      >
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShieldAlert size={48} className="text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground">You don&apos;t have permission to manage users.</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="max-w-screen-md mx-auto space-y-6"
      {...pageEntrance}
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center shrink-0">
                <Users size={18} className="text-point" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Users</h2>
                <p className="text-xs text-muted-foreground truncate">Manage user accounts and roles</p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<UserPlus size={14} />}
              onClick={() => setShowCreateUser(true)}
              className="shrink-0"
            >
              Add User
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!usersLoaded && <Indicator variant="linear" className="pb-4" />}
          {!usersLoaded ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} height={48} />
              ))}
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users found</p>
          ) : (
            <div className="space-y-3">
              {users.map((u) => {
                const isSelf = u.id === user?.userId;
                const isSA = u.role === "admin";
                return (
                  <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 border-b border-border last:border-0">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-sm font-medium">{u.username}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant={roleBadgeVariant(u.role)}>
                        {u.role}
                      </Badge>
                    </div>
                    {!isSelf && !isSA && (
                      <div className="flex items-center gap-2 shrink-0">
                        <Select
                          size="sm"
                          options={[
                            { value: "manager", label: "Manager" },
                            { value: "viewer", label: "Viewer" },
                          ]}
                          value={u.role}
                          onChange={(val) => handleChangeRole(u.id, val as UserRole)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteUser(u)}
                          leftIcon={<Trash2 size={14} />}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>

        {/* Create User Modal */}
        <Modal open={showCreateUser} onClose={() => setShowCreateUser(false)} size="sm">
          <ModalHeader>
            <ModalTitle>Create User</ModalTitle>
          </ModalHeader>
          <div className="px-6 pb-2 space-y-4">
            <Input
              label="Username"
              value={newUsername}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUsername(e.target.value)}
              placeholder="Enter username"
            />
            <Input
              label="Password"
              type="password"
              value={newUserPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUserPassword(e.target.value)}
              placeholder="Min 8 chars, 1 letter, 1 number"
            />
            <Select
              label="Role"
              options={[
                { value: "manager", label: "Manager" },
                { value: "viewer", label: "Viewer" },
              ]}
              value={newUserRole}
              onChange={(val) => setNewUserRole(val as UserRole)}
            />
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setShowCreateUser(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={creating || !newUsername || !newUserPassword}
              onClick={handleCreateUser}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </ModalFooter>
        </Modal>
      </Card>
    </motion.div>
  );
}
