"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useRoutes } from "@/hooks/useRoutes";
import { RouteForm } from "@/components/routes/RouteForm";
import { Card, CardContent, Button, useToast, Skeleton, pageEntrance } from "@tac-ui/web";
import { ChevronLeft } from "@tac-ui/icon";
import type { ProxyHost } from "@/types";

export default function EditRoutePage() {
  const params = useParams();
  const router = useRouter();
  const { routeList, loading, update } = useRoutes();
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const routeId = Number(params.id);
  const route = routeList.find((r) => r.id === routeId);

  const handleSubmit = async (data: Partial<ProxyHost>) => {
    setSubmitting(true);
    try {
      await update(routeId, data);
      toast("Route updated", { variant: "success" });
      router.push("/routes");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update route", { variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div className="max-w-screen-md mx-auto space-y-6" {...pageEntrance}>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={() => router.push("/routes")}
        >
          <ChevronLeft size={20} />
        </Button>
        <h1 className="text-xl font-bold">Edit Route</h1>
      </div>

      <Card>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          ) : !route ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">Route not found</p>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => router.push("/routes")}>
                Back to Routes
              </Button>
            </div>
          ) : (
            <RouteForm
              initial={route}
              onSubmit={handleSubmit}
              submitting={submitting}
              submitLabel="Update Route"
            />
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
