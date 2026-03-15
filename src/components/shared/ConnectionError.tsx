"use client";

import React from "react";
import { Button } from "@tac-ui/web";
import { WifiOff, RefreshCw } from "@tac-ui/icon";
import { useApiContext } from "@/contexts/ApiContext";

export function ConnectionError() {
  const { connectionFailed } = useApiContext();

  if (!connectionFailed) return null;

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 text-center w-full max-w-96 px-6">
        <div className="w-16 h-16 rounded-2xl bg-error/15 border border-error/30 flex items-center justify-center">
          <WifiOff size={28} className="text-error" />
        </div>

        <div>
          <h1 className="text-xl font-semibold mb-2">Unable to Connect</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Could not establish a connection to the Proxima server.
            Please check that the server is running and try again.
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full">
          <Button onClick={handleRetry} leftIcon={<RefreshCw size={14} />} className="w-full justify-center">
            Retry Connection
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>Possible causes:</p>
          <ul className="list-disc list-inside text-left">
            <li>Server is not running</li>
            <li>Network connection issue</li>
            <li>Firewall blocking the server</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
