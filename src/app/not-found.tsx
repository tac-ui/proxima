"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button, pageEntrance } from "@tac-ui/web";
import { ArrowLeft } from "@tac-ui/icon";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <motion.div className="flex flex-col items-center text-center px-6" {...pageEntrance}>
        <p className="text-7xl font-bold text-foreground">404</p>
        <p className="text-sm text-muted-foreground mt-3">
          The page you're looking for doesn't exist.
        </p>
        <Button
          className="mt-6"
          variant="ghost"
          leftIcon={<ArrowLeft size={14} />}
          onClick={() => router.push("/")}
        >
          Back to Dashboard
        </Button>
      </motion.div>
    </div>
  );
}
