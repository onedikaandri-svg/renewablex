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
            <p className="brand">RenewableX</p>
            <p className="tag">Screening kelayakan PV, versi pendahuluan</p>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer>
          <div className="wrap">RenewableX | Estimasi pendahuluan, bukan studi bankable</div>
        </footer>
      </body>
    </html>
  );
}
