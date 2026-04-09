"use client";

import React from "react";
import { OpenClawProvider } from "@/contexts/OpenClawContext";

export default function OpenClawLayout({ children }: { children: React.ReactNode }) {
  return (
    <OpenClawProvider>
      {children}
    </OpenClawProvider>
  );
}
