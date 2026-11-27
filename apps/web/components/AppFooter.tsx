"use client";

import { tr, usePreferences } from "@/lib/preferences";

export function SkipToMainLink() {
  const { lang } = usePreferences();
  return (
    <a href="#main-content" className="skip-link">
      {tr(lang, "Skip to main content", "Lewati ke konten utama", "メインコンテンツへスキップ")}
    </a>
  );
}

export default function AppFooter() {
  const { lang } = usePreferences();
  return (
    <footer>
      <div className="wrap">
        {tr(
          lang,
          "RenewableX · Hybrid Energy System Design & Quick PV Screening (Preliminary Engineering Estimate)",
          "RenewableX · Desain Sistem Energi Hybrid & Mode Cepat PV (Estimasi Teknis Awal)",
          "RenewableX · ハイブリッドエネルギーシステム設計および太陽光簡易試算（初期技術試算）",
        )}
      </div>
    </footer>
  );
}
