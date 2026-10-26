import type { ChatMessage, SessionState } from "@micheal/protocol";
import type { Lang } from "./lang.js";

export interface Observation {
  readonly text: string;
  readonly speak: boolean;
  readonly priority: "low" | "normal" | "high";
}

/** Jarvis-style ambient awareness: speak only when something matters. */
export function observeAmbient(opts: {
  readonly session: SessionState;
  readonly recent: readonly ChatMessage[];
  readonly lang: Lang;
  readonly now?: number;
  readonly lastSpokeAt: number;
}): Observation | null {
  const { session, recent, lang } = opts;
  const now = opts.now ?? Date.now();
  const fa = lang === "fa";
  const quietMs = now - opts.lastSpokeAt;
  const sessionAge = now - session.startedAt;
  const idleMs = now - session.lastActionAt;

  // Keep mic free: only rare high-priority spoken nudges (text-only otherwise)
  if (quietMs < 120_000) return null;

  // Don't nag about empty board — wake conversation handles that
  if (!session.symbol || !session.timeframe) {
    return null;
  }

  const hops = session.symbolSwitches + session.timeframeSwitches;
  if (hops >= 4) {
    return {
      priority: "high",
      speak: true,
      text: fa
        ? `دارم می‌بینم — ${hops} تا پرش در چند دقیقه. این تعقیبه، نه خواندن. یک چارت انتخاب کن؛ من نگهت می‌دارم.`
        : `I see it — ${hops} hops in minutes. That's chasing, not reading. Pick one chart; I'll hold the line.`,
    };
  }

  if (!session.focusMode && idleMs > 10 * 60_000 && quietMs > 180_000) {
    const mins = Math.round(idleMs / 60_000);
    return {
      priority: "normal",
      speak: false,
      text: fa
        ? `${mins} دقیقه‌ست روی ${session.symbol} ساکتی. هنوز توی پلن هستی، یا داری منحرف می‌شی؟ من اینجام.`
        : `${mins} minutes quiet on ${session.symbol}. Still in the plan, or drifting? I'm here.`,
    };
  }

  if (session.bias === "unknown" && sessionAge > 8 * 60_000 && quietMs > 200_000) {
    return {
      priority: "low",
      speak: false,
      text: fa
        ? `هنوز بایاس قفل نیست روی ${session.symbol}. جهت رو بگو — لانگ، شورت، یا فلت — تا درست مراقبت کنم.`
        : `Bias still unlocked on ${session.symbol}. Call the direction — long, short, or flat — so I can watch properly.`,
    };
  }

  if (!session.note && sessionAge > 12 * 60_000 && quietMs > 240_000) {
    return {
      priority: "low",
      speak: false,
      text: fa
        ? `پلن/ابطال خالیه. یک جمله ابطال بگو؛ من مثل جارویس بهش پایبندت می‌کنم.`
        : `Plan/invalidation is empty. State one invalidation line; I'll hold you to it like Jarvis.`,
    };
  }

  return null;
}
