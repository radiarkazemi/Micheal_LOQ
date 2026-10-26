import type { Bias, SessionState } from "@micheal/protocol";
import type { Lang } from "./lang.js";

const SWITCH_WINDOW_MS = 3 * 60_000;
const IDLE_NUDGE_MS = 8 * 60_000;

interface Hop {
  readonly at: number;
}

type Mutable = {
  -readonly [K in keyof SessionState]: SessionState[K];
};

export interface FocusHint {
  readonly text: string;
  readonly priority: "low" | "normal" | "high";
}

export class TradingSession {
  private readonly state: Mutable;
  private readonly symbolHops: Hop[] = [];
  private readonly tfHops: Hop[] = [];
  private lastIdleNudgeAt = 0;
  private lang: Lang = "fa";

  constructor(seed?: Partial<SessionState>) {
    const now = Date.now();
    this.state = {
      // No defaults — choose together each session
      symbol: seed?.symbol ?? "",
      timeframe: seed?.timeframe ?? "",
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

  setLang(lang: Lang): void {
    this.lang = lang;
  }

  getLang(): Lang {
    return this.lang;
  }

  snapshot(): SessionState {
    return { ...this.state };
  }

  patch(partial: Partial<SessionState>): FocusHint | null {
    let hint: FocusHint | null = null;
    if (partial.symbol != null) hint = this.setSymbol(partial.symbol) ?? hint;
    if (partial.timeframe != null) hint = this.setTimeframe(partial.timeframe) ?? hint;
    if (partial.price !== undefined) {
      this.state.price = partial.price;
      this.state.lastActionAt = Date.now();
    }
    if (partial.bias != null) {
      this.state.bias = partial.bias as Bias;
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
            ? "محمد، فوکوس مود فعاله. حرف کمتر؛ فقط ریسک جدی قطع می‌کنم."
            : "Focus mode engaged, Mohammad. I'll keep chatter minimal and interrupt only for material risk."
          : fa
            ? "محمد، فوکوس آزاد شد. حالت گفت‌وگوی کامل برگشت."
            : "Focus mode released, Mohammad. Full conversational mode restored.",
      };
    }
    return hint;
  }

  touch(): void {
    this.state.lastActionAt = Date.now();
  }

  checkIdle(now = Date.now()): FocusHint | null {
    if (this.state.focusMode) return null;
    if (now - this.state.lastActionAt < IDLE_NUDGE_MS) return null;
    if (now - this.lastIdleNudgeAt < IDLE_NUDGE_MS) return null;
    this.lastIdleNudgeAt = now;
    const mins = Math.round((now - this.state.lastActionAt) / 60_000);
    const fa = this.lang === "fa";
    const where = this.state.symbol || (fa ? "جلسه" : "the session");
    return {
      priority: "normal",
      text: fa
        ? `حدود ${mins} دقیقه روی ${where} ساکت بودی. هنوز پلن رو اجرا می‌کنی یا داری منحرف می‌شی؟`
        : `You've been quiet for about ${mins} minutes on ${where}. Still executing the plan, or drifting?`,
    };
  }

  private setSymbol(symbol: string): FocusHint | null {
    const next = symbol.trim().toUpperCase();
    if (!next || next === this.state.symbol) return null;
    const now = Date.now();
    const hadSymbol = Boolean(this.state.symbol);
    this.state.symbol = next;
    this.state.lastActionAt = now;
    if (hadSymbol) {
      this.symbolHops.push({ at: now });
      this.prune(this.symbolHops, now);
      this.state.symbolSwitches = this.symbolHops.length;
    }
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

  private setTimeframe(timeframe: string): FocusHint | null {
    const next = timeframe.trim();
    if (!next || next === this.state.timeframe) return null;
    const now = Date.now();
    const hadTf = Boolean(this.state.timeframe);
    this.state.timeframe = next;
    this.state.lastActionAt = now;
    if (hadTf) {
      this.tfHops.push({ at: now });
      this.prune(this.tfHops, now);
      this.state.timeframeSwitches = this.tfHops.length;
    }
    const fa = this.lang === "fa";
    if (hadTf && this.tfHops.length >= 5) {
      return {
        priority: "high",
        text: fa
          ? `پرش تایم‌فریم دیدم. شک اغلب خودش رو «تأیید بیشتر» جا می‌زنه. یک‌کم روی ${next} بمون.`
          : `Timeframe hopping detected. Doubt often disguises itself as "more confirmation." Stay on ${next} for a stretch.`,
      };
    }
    return null;
  }

  private prune(hops: Hop[], now: number): void {
    while (hops.length && now - hops[0]!.at > SWITCH_WINDOW_MS) hops.shift();
  }
}
