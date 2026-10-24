/** Lightweight EN/FA detection for Micheal replies. */

export type Lang = "en" | "fa";

const PERSIAN_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function detectLang(text: string | undefined | null): Lang {
  const t = (text ?? "").trim();
  if (!t) return "en";
  if (PERSIAN_RE.test(t)) return "fa";
  // Common romanized Persian greetings / trading words
  if (/\b(salam|salaam|khoobi|chetori|mamnoon|merci|dorost|bale|na)\b/i.test(t)) {
    return "fa";
  }
  return "en";
}

export function isPersian(text: string | undefined | null): boolean {
  return detectLang(text) === "fa";
}
