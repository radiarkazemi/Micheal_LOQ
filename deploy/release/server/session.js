const SWITCH_WINDOW_MS = 3 * 60_000;
const IDLE_NUDGE_MS = 8 * 60_000;
export class TradingSession {
    state;
    symbolHops = [];
    tfHops = [];
    lastIdleNudgeAt = 0;
    constructor(seed) {
        const now = Date.now();
        this.state = {
            symbol: seed?.symbol ?? "XAUUSD",
            timeframe: seed?.timeframe ?? "15",
            price: seed?.price ?? null,
            bias: seed?.bias ?? "unknown",
            note: seed?.note ?? "",
            focusMode: seed?.focusMode ?? false,
            symbolSwitches: 0,
            timeframeSwitches: 0,
            lastActionAt: now,
            startedAt: now,
        };
    }
    snapshot() {
        return { ...this.state };
    }
    patch(partial) {
        let hint = null;
        if (partial.symbol != null)
            hint = this.setSymbol(partial.symbol) ?? hint;
        if (partial.timeframe != null)
            hint = this.setTimeframe(partial.timeframe) ?? hint;
        if (partial.price !== undefined) {
            this.state.price = partial.price;
            this.state.lastActionAt = Date.now();
        }
        if (partial.bias != null) {
            this.state.bias = partial.bias;
            this.state.lastActionAt = Date.now();
        }
        if (partial.note != null) {
            this.state.note = partial.note;
            this.state.lastActionAt = Date.now();
        }
        if (partial.focusMode != null && partial.focusMode !== this.state.focusMode) {
            this.state.focusMode = partial.focusMode;
            this.state.lastActionAt = Date.now();
            hint = {
                priority: "normal",
                text: partial.focusMode
                    ? "Focus mode engaged, sir. I'll keep chatter minimal and interrupt only for material risk."
                    : "Focus mode released. Full conversational mode restored.",
            };
        }
        return hint;
    }
    touch() {
        this.state.lastActionAt = Date.now();
    }
    checkIdle(now = Date.now()) {
        if (this.state.focusMode)
            return null;
        if (now - this.state.lastActionAt < IDLE_NUDGE_MS)
            return null;
        if (now - this.lastIdleNudgeAt < IDLE_NUDGE_MS)
            return null;
        this.lastIdleNudgeAt = now;
        const mins = Math.round((now - this.state.lastActionAt) / 60_000);
        return {
            priority: "normal",
            text: `You've been quiet for about ${mins} minutes on ${this.state.symbol}. Still executing the plan, or drifting?`,
        };
    }
    setSymbol(symbol) {
        const next = symbol.trim().toUpperCase();
        if (!next || next === this.state.symbol)
            return null;
        const now = Date.now();
        this.state.symbol = next;
        this.state.lastActionAt = now;
        this.symbolHops.push({ at: now });
        this.prune(this.symbolHops, now);
        this.state.symbolSwitches = this.symbolHops.length;
        if (this.symbolHops.length >= 4) {
            return {
                priority: "high",
                text: `Easy. ${this.symbolHops.length} symbol changes in three minutes. That looks like chasing, not analysis. Pick one chart.`,
            };
        }
        return {
            priority: "low",
            text: `Understood — watching ${next} with you.`,
        };
    }
    setTimeframe(timeframe) {
        const next = timeframe.trim();
        if (!next || next === this.state.timeframe)
            return null;
        const now = Date.now();
        this.state.timeframe = next;
        this.state.lastActionAt = now;
        this.tfHops.push({ at: now });
        this.prune(this.tfHops, now);
        this.state.timeframeSwitches = this.tfHops.length;
        if (this.tfHops.length >= 5) {
            return {
                priority: "high",
                text: `Timeframe hopping detected. Doubt often disguises itself as "more confirmation." Stay on ${next} for a stretch.`,
            };
        }
        return null;
    }
    prune(hops, now) {
        while (hops.length && now - hops[0].at > SWITCH_WINDOW_MS)
            hops.shift();
    }
}
