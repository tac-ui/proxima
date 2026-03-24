import type { Metadata } from "next";
import "@/styles/globals.css";
import { Providers } from "./providers";

function getBranding() {
  try {
    const { ensureDb } = require("@/app/api/_lib/db");
    const { getDb, dbHelpers } = require("@server/db/index");
    ensureDb();
    const db = getDb();
    const appName = dbHelpers.getSetting(db, "branding:appName")?.value || "Proxima";
    const logoUrl = dbHelpers.getSetting(db, "branding:logoUrl")?.value || "";
    const faviconUrl = dbHelpers.getSetting(db, "branding:faviconUrl")?.value || "";
    const ogTitle = dbHelpers.getSetting(db, "branding:ogTitle")?.value || "";
    const ogDescription = dbHelpers.getSetting(db, "branding:ogDescription")?.value || "";
    return { appName, logoUrl, faviconUrl, ogTitle, ogDescription };
  } catch {
    return { appName: "Proxima", logoUrl: "", faviconUrl: "", ogTitle: "", ogDescription: "" };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { appName, logoUrl, faviconUrl, ogTitle, ogDescription } = getBranding();
  const defaultDescription = `${appName} — All-in-one server management panel`;
  const iconUrl = faviconUrl || logoUrl || "/logo.svg";

  return {
    title: {
      default: appName,
      template: `%s · ${appName}`,
    },
    description: ogDescription || defaultDescription,
    icons: {
      icon: iconUrl,
      apple: iconUrl,
    },
    openGraph: {
      title: ogTitle || appName,
      description: ogDescription || defaultDescription,
      siteName: appName,
      type: "website",
      ...(logoUrl ? { images: [{ url: logoUrl, width: 512, height: 512, alt: ogTitle || appName }] } : {}),
    },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="antialiased h-full overflow-x-hidden">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
