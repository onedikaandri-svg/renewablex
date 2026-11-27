"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { IconBookOpen, IconLayers, IconMoon, IconSun, IconZap } from "@/components/Icons";
import { getProject, HYBRID_PROJECT_UPDATED_EVENT, saveProject } from "@/lib/hybrid-storage";
import { usePreferences, type CurrencyCode } from "@/lib/preferences";

const HYBRID_STUDIO_VERSION = "v0.7.0";

function extractActiveHybridProjectId(pathname: string): string | null {
  const match = pathname.match(/^\/hybrid\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  const segment = match[1];
  if (!segment || segment === "guide") return null;
  return segment;
}

export default function AppHeader() {
  const pathname = usePathname() || "/";
  const { theme, setTheme, lang, setLang, currency, setCurrency } = usePreferences();
  const isGuide = pathname.startsWith("/hybrid/guide");
  const isHybrid = pathname.startsWith("/hybrid");
  const activeProjectId = useMemo(() => extractActiveHybridProjectId(pathname), [pathname]);
  const [projectCurrency, setProjectCurrency] = useState<CurrencyCode | null>(null);

  useEffect(() => {
    if (!activeProjectId) {
      setProjectCurrency(null);
      return;
    }

    function syncFromStorage() {
      if (!activeProjectId) return;
      const p = getProject(activeProjectId);
      const code = p?.project.currency_code ?? null;
      setProjectCurrency(code);
      if (code && code !== currency) {
        setCurrency(code);
      }
    }

    syncFromStorage();

    function handleProjectUpdated(e: Event) {
      const detail = (e as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== activeProjectId) return;
      const p = activeProjectId ? getProject(activeProjectId) : null;
      const code = p?.project.currency_code ?? null;
      setProjectCurrency(code);
      if (code) {
        setCurrency(code);
      }
    }

    window.addEventListener(HYBRID_PROJECT_UPDATED_EVENT, handleProjectUpdated);
    return () => {
      window.removeEventListener(HYBRID_PROJECT_UPDATED_EVENT, handleProjectUpdated);
    };
  }, [activeProjectId]);

  const effectiveCurrency: CurrencyCode = activeProjectId && projectCurrency ? projectCurrency : currency;

  function handleSelectCurrency(nextCurrency: CurrencyCode) {
    setCurrency(nextCurrency);
    if (activeProjectId) {
      const p = getProject(activeProjectId);
      if (p && p.project.currency_code !== nextCurrency) {
        saveProject({
          ...p,
          project: {
            ...p.project,
            currency_code: nextCurrency,
          },
        });
      }
      setProjectCurrency(nextCurrency);
    }
  }

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
              <IconZap size={15} />
              {lang === "en" ? "Quick PV" : "Mode Cepat PV"}
            </Link>
            <Link href="/hybrid" className="mode-link" aria-current={isHybrid && !isGuide ? "page" : undefined}>
              <IconLayers size={15} />
              {lang === "en" ? "Hybrid Design" : "Desain Hybrid"}
            </Link>
            <Link href="/hybrid/guide" className="mode-link" aria-current={isGuide ? "page" : undefined}>
              <IconBookOpen size={15} />
              {lang === "en" ? "Guide" : "Panduan"}
            </Link>
          </nav>

          <div className="seg-group" role="group" aria-label={lang === "en" ? "Currency" : "Mata uang"}>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={effectiveCurrency === "IDR"}
              onClick={() => handleSelectCurrency("IDR")}
            >
              IDR
            </button>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={effectiveCurrency === "USD"}
              onClick={() => handleSelectCurrency("USD")}
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
              className="seg-btn seg-icon"
              aria-pressed={theme === "light"}
              aria-label={lang === "en" ? "Light theme" : "Tema Terang"}
              title={lang === "en" ? "Light theme" : "Tema Terang"}
              onClick={() => setTheme("light")}
            >
              <IconSun size={15} />
            </button>
            <button
              type="button"
              className="seg-btn seg-icon"
              aria-pressed={theme === "dark"}
              aria-label={lang === "en" ? "Dark theme" : "Tema Gelap"}
              title={lang === "en" ? "Dark theme" : "Tema Gelap"}
              onClick={() => setTheme("dark")}
            >
              <IconMoon size={15} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
