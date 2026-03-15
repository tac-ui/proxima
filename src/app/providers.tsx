"use client";

import { TacProvider, ToastProvider } from "@tac-ui/web";
import { ApiProvider } from "@/contexts/ApiContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ConfirmProvider } from "@/hooks/useConfirm";
import { BrandingProvider } from "@/contexts/BrandingContext";
import { ConnectionError } from "@/components/shared/ConnectionError";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TacProvider defaultTheme="dark">
      <ToastProvider position="bottom-right">
        <ConfirmProvider>
          <BrandingProvider>
            <AuthProvider>
              <ApiProvider>
                <ConnectionError />
                {children}
              </ApiProvider>
            </AuthProvider>
          </BrandingProvider>
        </ConfirmProvider>
      </ToastProvider>
    </TacProvider>
  );
}
