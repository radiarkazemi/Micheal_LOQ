import type { ChatMessage, SessionState } from "@micheal/protocol";
import type { ServerConfig } from "./config.js";
import { type Lang } from "./lang.js";
export interface BrainReply {
    readonly text: string;
    readonly speak: boolean;
    readonly lang: Lang;
}
export declare function think(opts: {
    readonly config: ServerConfig;
    readonly session: SessionState;
    readonly recent: readonly ChatMessage[];
    readonly utterance?: string;
    readonly preferredLang?: Lang;
}): Promise<BrainReply>;
