"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePreferences } from "@/lib/preferences";

const HYBRID_STUDIO_VERSION = "v0.7.0";

export default function AppHeader() {
  const pathname = usePathname() || "/";
  const { theme, setTheme, lang, setLang, currency, setCurrency } = usePreferences();
  const isGuide = pathname.startsWith("/hybrid/guide");
  const isHybrid = pathname.startsWith("/hybrid");

  return (
    <header className="top">
      <div className="wrap">
        <Link href="/" className="brand-group">
          <div className="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          </div>
          <p className="brand">RenewableX</p>
          <span className="chip">{isHybrid ? `Hybrid Studio ${HYBRID_STUDIO_VERSION}` : "PV Screening v0.2"}</span>
        </Link>

        <div className="header-controls">
          <nav className="mode-nav" aria-label={lang === "en" ? "Workspace mode" : "Mode kerja"}>
            <Link href="/" className="mode-link" aria-current={!isHybrid ? "page" : undefined}>
              {lang === "en" ? "Quick PV" : "Mode Cepat PV"}
            </Link>
            <Link href="/hybrid" className="mode-link" aria-current={isHybrid && !isGuide ? "page" : undefined}>
              {lang === "en" ? "Hybrid Design" : "Desain Hybrid"}
            </Link>
            <Link href="/hybrid/guide" className="mode-link" aria-current={isGuide ? "page" : undefined}>
              {lang === "en" ? "Guide" : "Panduan"}
            </Link>
          </nav>

          <div className="seg-group" role="group" aria-label={lang === "en" ? "Currency" : "Mata uang"}>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={currency === "IDR"}
              onClick={() => setCurrency("IDR")}
            >
              IDR
            </button>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={currency === "USD"}
              onClick={() => setCurrency("USD")}
            >
              USD
            </button>
          </div>

          <div className="seg-group" role="group" aria-label={lang === "en" ? "Language" : "Bahasa"}>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={lang === "id"}
              onClick={() => setLang("id")}
            >
              ID
            </button>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={lang === "en"}
              onClick={() => setLang("en")}
            >
              EN
            </button>
          </div>

          <div className="seg-group" role="group" aria-label={lang === "en" ? "Color theme" : "Tema warna"}>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              {lang === "en" ? "Light" : "Terang"}
            </button>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              {lang === "en" ? "Dark" : "Gelap"}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
