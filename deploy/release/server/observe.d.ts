import type { ChatMessage, SessionState } from "@micheal/protocol";
import type { Lang } from "./lang.js";
export interface Observation {
    readonly text: string;
    readonly speak: boolean;
    readonly priority: "low" | "normal" | "high";
}
/** Jarvis-style ambient awareness: speak only when something matters. */
export declare function observeAmbient(opts: {
    readonly session: SessionState;
    readonly recent: readonly ChatMessage[];
    readonly lang: Lang;
    readonly now?: number;
    readonly lastSpokeAt: number;
}): Observation | null;
