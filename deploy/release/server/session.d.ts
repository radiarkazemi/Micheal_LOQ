import type { SessionState } from "@micheal/protocol";
export interface FocusHint {
    readonly text: string;
    readonly priority: "low" | "normal" | "high";
}
export declare class TradingSession {
    private readonly state;
    private readonly symbolHops;
    private readonly tfHops;
    private lastIdleNudgeAt;
    constructor(seed?: Partial<SessionState>);
    snapshot(): SessionState;
    patch(partial: Partial<SessionState>): FocusHint | null;
    touch(): void;
    checkIdle(now?: number): FocusHint | null;
    private setSymbol;
    private setTimeframe;
    private prune;
}
