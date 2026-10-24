export type Role = "micheal" | "you" | "system";
export type Bias = "long" | "short" | "flat" | "unknown";
export interface SessionState {
    readonly symbol: string;
    readonly timeframe: string;
    readonly price: number | null;
    readonly bias: Bias;
    readonly note: string;
    readonly focusMode: boolean;
    readonly symbolSwitches: number;
    readonly timeframeSwitches: number;
    readonly lastActionAt: number;
    readonly startedAt: number;
}
export interface ChatMessage {
    readonly id: string;
    readonly role: Role;
    readonly text: string;
    readonly at: number;
    readonly spoken?: boolean;
}
/** Client → server */
export type ClientPacket = {
    readonly type: "hello";
    readonly client: "desktop";
    readonly token: string;
} | {
    readonly type: "chat";
    readonly text: string;
    readonly id?: string;
} | {
    readonly type: "session.patch";
    readonly patch: Partial<SessionState>;
} | {
    readonly type: "ping";
};
/** Server → client */
export type ServerPacket = {
    readonly type: "welcome";
    readonly session: SessionState;
    readonly serverTime: number;
} | {
    readonly type: "message";
    readonly message: ChatMessage;
} | {
    readonly type: "session";
    readonly session: SessionState;
} | {
    readonly type: "status";
    readonly status: string;
} | {
    readonly type: "error";
    readonly error: string;
} | {
    readonly type: "pong";
    readonly serverTime: number;
};
export declare const PROTOCOL_VERSION = 1;
//# sourceMappingURL=index.d.ts.map