import type { SessionState } from "@micheal/protocol";
/** Parse spoken/typed Persian+EN into session fields so we choose together. */
export declare function extractSessionPatch(text: string): Partial<SessionState> | null;
