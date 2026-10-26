/** Lightweight EN/FA detection for Micheal replies. */

export type Lang = "en" | "fa";

const PERSIAN_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function detectLang(text: string | undefined | null): Lang {
  const t = (text ?? "").trim();
  // Empty / wake → Persian-first (Micheal default)
  if (!t) return "fa";
  if (PERSIAN_RE.test(t)) return "fa";
  if (/\b(salam|salaam|khoobi|chetori|mamnoon|merci|dorost|bale|na)\b/i.test(t)) {
    return "fa";
  }
  return "en";
}

export function isPersian(text: string | undefined | null): boolean {
  return detectLang(text) === "fa";
}
