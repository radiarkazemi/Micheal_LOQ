import type { ChatMessage, SessionState } from "@micheal/protocol";
import type { ServerConfig } from "./config.js";
export interface BrainReply {
    readonly text: string;
    readonly speak: boolean;
}
export declare function think(opts: {
    readonly config: ServerConfig;
    readonly session: SessionState;
    readonly recent: readonly ChatMessage[];
    readonly utterance?: string;
}): Promise<BrainReply>;
