"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button, pageEntrance } from "@tac-ui/web";
import { ArrowLeft, RotateCw } from "@tac-ui/icon";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <motion.div className="flex flex-col items-center text-center px-6" {...pageEntrance}>
        <p className="text-7xl font-bold text-foreground">500</p>
        <p className="text-sm text-muted-foreground mt-3">
          Something went wrong. Please try again.
        </p>
        <div className="flex items-center gap-2 mt-6">
          <Button
            variant="ghost"
            leftIcon={<ArrowLeft size={14} />}
            onClick={() => router.push("/")}
          >
            Back to Dashboard
          </Button>
          <Button
            leftIcon={<RotateCw size={14} />}
            onClick={reset}
          >
            Try Again
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
