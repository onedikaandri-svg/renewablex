"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark";
export type LangCode = "id" | "en";
export type CurrencyCode = "IDR" | "USD";

interface PreferencesContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  lang: LangCode;
  setLang: (lang: LangCode) => void;
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

const STORAGE_KEY = "renewablex.preferences.v1";

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("light");
  const [lang, setLangState] = useState<LangCode>("id");
  const [currency, setCurrencyState] = useState<CurrencyCode>("IDR");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{ theme: ThemeMode; lang: LangCode; currency: CurrencyCode }>;
        if (parsed.theme === "light" || parsed.theme === "dark") setThemeState(parsed.theme);
        if (parsed.lang === "id" || parsed.lang === "en") setLangState(parsed.lang);
        if (parsed.currency === "IDR" || parsed.currency === "USD") setCurrencyState(parsed.currency);
      } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setThemeState("dark");
      }
    } catch {
      // Abaikan error akses localStorage pada mode privat.
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, lang, currency }));
    } catch {
      // Abaikan error akses localStorage.
    }
  }, [theme, lang, currency]);

  return (
    <PreferencesContext.Provider
      value={{
        theme,
        setTheme: setThemeState,
        lang,
        setLang: setLangState,
        currency,
        setCurrency: setCurrencyState,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error("usePreferences harus dipanggil di dalam PreferencesProvider.");
  }
  return ctx;
}
