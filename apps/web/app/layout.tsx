import type { Metadata, Viewport } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "./globals.css";
import AppFooter, { SkipToMainLink } from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import { ToastProvider } from "@/components/Toast";
import { PreferencesProvider } from "@/lib/preferences";

export const metadata: Metadata = {
  title: "RenewableX: Hybrid Energy System Design & PV Screening",
  description: "Hybrid energy system simulation (PV, BESS, Biomass, Diesel, EMS) and preliminary PV feasibility screening.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PreferencesProvider>
          <ToastProvider>
            <SkipToMainLink />
            <AppHeader />
            <main id="main-content" className="wrap" tabIndex={-1}>
              {children}
            </main>
            <AppFooter />
          </ToastProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
