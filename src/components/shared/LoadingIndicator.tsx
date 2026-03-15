"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Indicator } from "@tac-ui/web";

interface LoadingIndicatorProps {
  visible: boolean;
  className?: string;
}

export function LoadingIndicator({ visible, className }: LoadingIndicatorProps) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          layout
          initial={{ opacity: 0, height: 0 }}
          animate={{
            opacity: 1,
            height: "auto",
            transition: {
              height: { duration: 0.35, ease: [0.4, 0, 0.2, 1] },
              opacity: { duration: 0.2, delay: 0.1 },
            },
          }}
          exit={{
            opacity: 0,
            height: 0,
            margin: 0,
            padding: 0,
            transition: {
              opacity: { duration: 0.15 },
              height: { duration: 0.3, delay: 0.05, ease: [0.4, 0, 0.2, 1] },
              margin: { duration: 0.3, delay: 0.05 },
              padding: { duration: 0.3, delay: 0.05 },
            },
          }}
          style={{ overflow: "hidden", flexShrink: 0 }}
          className={className}
        >
          <Indicator variant="linear" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
