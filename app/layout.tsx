import type { Metadata, Viewport } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "RenewableX: Screening Kelayakan PV Pendahuluan",
  description: "Hitung energi, NPV, IRR, dan payback proyek PV dari asumsi Anda. Estimasi pendahuluan, bukan studi bankable.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <header className="top">
          <div className="wrap">
            <div className="brand-group">
              <div className="brand-mark" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
              </div>
              <p className="brand">RenewableX</p>
              <span className="chip">PV Screening v0.2</span>
            </div>
            <p className="tag">Screening kelayakan PV, versi pendahuluan</p>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer>
          <div className="wrap">RenewableX · Estimasi pendahuluan, bukan studi bankable</div>
        </footer>
      </body>
    </html>
  );
}
