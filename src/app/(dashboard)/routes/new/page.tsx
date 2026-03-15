"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useRoutes } from "@/hooks/useRoutes";
import { RouteForm } from "@/components/routes/RouteForm";
import { Card, CardContent, Button, useToast, pageEntrance } from "@tac-ui/web";
import { ChevronLeft } from "@tac-ui/icon";

export default function NewRoutePage() {
  const router = useRouter();
  const { create } = useRoutes();
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (data: Parameters<typeof create>[0]) => {
    setSubmitting(true);
    try {
      await create(data);
      toast("Route created", { variant: "success" });
      router.push("/routes");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create route", { variant: "error" });
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
        <h1 className="text-xl font-bold">Add Route</h1>
      </div>

      <Card>
        <CardContent>
          <RouteForm
            onSubmit={handleSubmit}
            submitting={submitting}
            submitLabel="Create Route"
          />
        </CardContent>
      </Card>
    </motion.div>
  );
}
