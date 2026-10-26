import type { SessionState } from "@micheal/protocol";
import type { Lang } from "./lang.js";
export interface FocusHint {
    readonly text: string;
    readonly priority: "low" | "normal" | "high";
}
export declare class TradingSession {
    private readonly state;
    private readonly symbolHops;
    private readonly tfHops;
    private lastIdleNudgeAt;
    private lang;
    constructor(seed?: Partial<SessionState>);
    setLang(lang: Lang): void;
    getLang(): Lang;
    snapshot(): SessionState;
    patch(partial: Partial<SessionState>): FocusHint | null;
    touch(): void;
    checkIdle(now?: number): FocusHint | null;
    private setSymbol;
    private setTimeframe;
    private prune;
}
