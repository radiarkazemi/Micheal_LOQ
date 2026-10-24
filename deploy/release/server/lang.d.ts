/** Lightweight EN/FA detection for Micheal replies. */
export type Lang = "en" | "fa";
export declare function detectLang(text: string | undefined | null): Lang;
export declare function isPersian(text: string | undefined | null): boolean;
