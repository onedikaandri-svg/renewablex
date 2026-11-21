export const fmt = (n: number, digits = 0) => n.toLocaleString("id-ID", { maximumFractionDigits: digits });

export const money = (v: number, currency: string) => `${fmt(v / 1e9, 2)} miliar ${currency}`;
