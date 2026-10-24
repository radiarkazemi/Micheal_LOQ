const SWITCH_WINDOW_MS = 3 * 60_000;
const IDLE_NUDGE_MS = 8 * 60_000;
export class TradingSession {
    state;
    symbolHops = [];
    tfHops = [];
    lastIdleNudgeAt = 0;
    lang = "en";
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
    setLang(lang) {
        this.lang = lang;
    }
    getLang() {
        return this.lang;
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
            const fa = this.lang === "fa";
            hint = {
                priority: "normal",
                text: partial.focusMode
                    ? fa
                        ? "فوکوس مود فعاله. حرف کمتر؛ فقط ریسک جدی قطع می‌کنم."
                        : "Focus mode engaged, sir. I'll keep chatter minimal and interrupt only for material risk."
                    : fa
                        ? "فوکوس آزاد شد. حالت گفت‌وگوی کامل برگشت."
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
        const fa = this.lang === "fa";
        return {
            priority: "normal",
            text: fa
                ? `حدود ${mins} دقیقه روی ${this.state.symbol} ساکت بودی. هنوز پلن رو اجرا می‌کنی یا داری منحرف می‌شی؟`
                : `You've been quiet for about ${mins} minutes on ${this.state.symbol}. Still executing the plan, or drifting?`,
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
        const fa = this.lang === "fa";
        if (this.symbolHops.length >= 4) {
            return {
                priority: "high",
                text: fa
                    ? `آروم. ${this.symbolHops.length} تا تعویض نماد در سه دقیقه. بیشتر شبیه تعقیبه تا تحلیل. یک چارت انتخاب کن.`
                    : `Easy. ${this.symbolHops.length} symbol changes in three minutes. That looks like chasing, not analysis. Pick one chart.`,
            };
        }
        return {
            priority: "low",
            text: fa ? `باشه — با هم ${next} رو می‌بینیم.` : `Understood — watching ${next} with you.`,
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
        const fa = this.lang === "fa";
        if (this.tfHops.length >= 5) {
            return {
                priority: "high",
                text: fa
                    ? `پرش تایم‌فریم دیدم. شک اغلب خودش رو «تأیید بیشتر» جا می‌زنه. یک‌کم روی ${next} بمون.`
                    : `Timeframe hopping detected. Doubt often disguises itself as "more confirmation." Stay on ${next} for a stretch.`,
            };
        }
        return null;
    }
    prune(hops, now) {
        while (hops.length && now - hops[0].at > SWITCH_WINDOW_MS)
            hops.shift();
    }
}
