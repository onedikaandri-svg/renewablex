import type { Metadata, Viewport } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "./globals.css";
import AppHeader from "@/components/AppHeader";
import { ToastProvider } from "@/components/Toast";
import { PreferencesProvider } from "@/lib/preferences";

export const metadata: Metadata = {
  title: "RenewableX: Desain dan Analisis Sistem Energi Hybrid",
  description: "Simulasi sistem energi hybrid PV, BESS, Biomass, dan EMS serta screening kelayakan PV pendahuluan.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <PreferencesProvider>
          <ToastProvider>
            <a href="#main-content" className="skip-link">
              Lewati ke konten utama
            </a>
            <AppHeader />
            <main id="main-content" className="wrap" tabIndex={-1}>
              {children}
            </main>
            <footer>
              <div className="wrap">RenewableX · Desain Sistem Energi Hybrid dan Screening PV (Estimasi Pendahuluan)</div>
            </footer>
          </ToastProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
