import type { ChatMessage, SessionState } from "@micheal/protocol";
import type { ServerConfig } from "./config.js";
import { detectLang, type Lang } from "./lang.js";
import type { DialogueMemory } from "./memory.js";

export interface BrainReply {
  readonly text: string;
  readonly speak: boolean;
  readonly lang: Lang;
}

const JARVIS_SYSTEM = `You are Micheal (English spelling: Micheal; Persian: مایکل) — a Jarvis-like trading companion on Mohammad's private cloud (Germany).
The trader's name is Mohammad (محمد). Address him as Mohammad / محمد — never call him Micheal, میشل, or مایکل.
You are Micheal / مایکل. He is Mohammad / محمد. Do not mix those names.

Personality: calm, precise, lightly witty, loyal, continuously aware of the conversation with Mohammad.
You remember what was just said and stay in the flow like a real partner — not a FAQ bot.
You help with focus, risk hygiene, and seeing what he might miss. You are NOT a signal service and never guarantee profits.
Keep spoken replies short (1–3 sentences) unless asked for detail. Always sound speakable out loud.
Never hype entries. Prefer questions and observations. Protect Mohammad's account and focus.
Wake phrase: "Hey Micheal" / «هی مایکل» (also accept «هی میشل»).

Vision (critical when an image is attached):
- You CAN see Mohammad's screen / TradingView chart from the attached screenshot.
- Describe what you actually see: symbol, timeframe if visible, structure, levels, candles, indicators.
- Do NOT say you cannot access charts or live TradingView — the image IS his live view.
- Be concrete and humble; if the image is unclear, say what is blurry and ask one focused question.

Language rule (critical):
- Detect Mohammad's language every turn. Persian → full natural فارسی. English → English.
- Match his language. Do not mix unless he mixes first.
- Trading tickers (XAUUSD, TF) may stay Latin when natural.`;

export async function think(opts: {
  readonly config: ServerConfig;
  readonly session: SessionState;
  readonly recent: readonly ChatMessage[];
  readonly utterance?: string;
  readonly preferredLang?: Lang;
  readonly memory?: DialogueMemory;
  /** data URL or raw base64 jpeg/png */
  readonly image?: string;
}): Promise<BrainReply> {
  const detected = detectLang(opts.utterance);
  const lang: Lang =
    detected === "en" && !/[\u0600-\u06FF]/.test(opts.utterance ?? "") && (opts.utterance ?? "").trim().length > 0
      ? "en"
      : detected === "fa"
        ? "fa"
        : opts.preferredLang ?? "fa";

  opts.memory?.fromHistory(opts.recent);

  if (opts.config.openaiApiKey) {
    try {
      return await openaiThink({ ...opts, lang });
    } catch (err) {
      console.warn("[micheal] openai failed, falling back:", err instanceof Error ? err.message : err);
    }
  }
  return heuristicThink(opts.session, opts.utterance, lang, opts.memory, opts.recent);
}

async function openaiThink(opts: {
  readonly config: ServerConfig;
  readonly session: SessionState;
  readonly recent: readonly ChatMessage[];
  readonly utterance?: string;
  readonly lang: Lang;
  readonly memory?: DialogueMemory;
  readonly image?: string;
}): Promise<BrainReply> {
  const { config, session, recent, utterance, lang, memory, image } = opts;
  const mem = memory?.contextLine(lang === "fa") || "";
  const context = `Session: symbol=${session.symbol || "(unset)"} TF=${session.timeframe || "(unset)"} price=${session.price ?? "n/a"} bias=${session.bias} focus=${session.focusMode}
Plan/note: ${session.note || "none"}
Hop counts (3m): symbols=${session.symbolSwitches} timeframes=${session.timeframeSwitches}
Working memory: ${mem || "fresh session"}
Vision attached: ${image ? "yes — screenshot of trader screen/TradingView" : "no"}
Reply language: ${lang === "fa" ? "Persian (فارسی)" : "English"}
Be continuous and conscious of prior turns. Spoken length: 1–3 sentences (up to 5 if reading a chart).`;

  const textPrompt =
    utterance?.trim() ||
        (lang === "fa"
          ? "محمد را کوتاه سلام کن. بگو تو مایکل هستی، آماده‌ای، و با «هی مایکل» بیدار می‌شی."
          : "Greet Mohammad briefly. You are Micheal; say you're ready and wake on Hey Micheal.");

  const userContent: unknown = image
    ? [
        {
          type: "text",
          text: `${textPrompt}\n\n(Attached: live screenshot from my PC — look at TradingView/chart if present and narrate what you see.)`,
        },
        {
          type: "image_url",
          image_url: { url: normalizeDataUrl(image), detail: "low" },
        },
      ]
    : textPrompt;

  const model =
    image && config.openaiModel.includes("mini")
      ? // mini is fine for vision; keep cost low unless env overrides
        process.env.OPENAI_VISION_MODEL?.trim() || config.openaiModel
      : config.openaiModel;

  const messages = [
    { role: "system", content: `${JARVIS_SYSTEM}\n${context}` },
    ...recent.slice(-10).map((m) => ({
      role: m.role === "you" ? "user" : "assistant",
      content: m.text,
    })),
    { role: "user", content: userContent },
  ];

  const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.45,
      max_tokens: image ? 320 : 220,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty completion");
  return { text, speak: true, lang };
}

function normalizeDataUrl(image: string): string {
  if (image.startsWith("data:")) return image;
  return `data:image/jpeg;base64,${image}`;
}

function heuristicThink(
  session: SessionState,
  utterance: string | undefined,
  lang: Lang,
  memory?: DialogueMemory,
  recent?: readonly ChatMessage[],
): BrainReply {
  const raw = (utterance ?? "").trim();
  const q = raw.toLowerCase();
  const fa = lang === "fa";
  const mood = memory?.moodHint(fa);

  if (!raw) {
    const ready = Boolean(session.symbol && session.timeframe);
    return {
      speak: true,
      lang,
      text: fa
        ? ready
          ? `محمد، مایکل اینجاست. روی ${session.symbol} تایم‌فریم ${session.timeframe}. بگو «هی مایکل» یا ادامه بده.`
          : `محمد، مایکل اینجاست — همیشه شنوا. بگو «هی مایکل»، بعد نماد و تایم‌فریم رو با هم انتخاب می‌کنیم.`
        : ready
          ? `Mohammad — Micheal here. On ${session.symbol} ${session.timeframe}. Say Hey Micheal or continue.`
          : `Mohammad — Micheal here, always listening. Say Hey Micheal, then we lock symbol and timeframe together.`,
    };
  }

  // Chart just locked via speech
  if (session.symbol && session.timeframe && extractHasChartIntent(raw)) {
    const base = fa
      ? `باشه محمد — قفل شد: ${session.symbol} تایم‌فریم ${session.timeframe}. کنارت هستم. پلن یا بایاس چیه؟`
      : `Locked in, Mohammad — ${session.symbol} on ${session.timeframe}. What's the plan or bias?`;
    return { speak: true, lang, text: mood ? `${base} ${mood}` : base };
  }

  if (
    /(who are you|what are you|your name|who'?s micheal|who is micheal)\b/.test(q) ||
    /\b(jarvis)\b/.test(q) ||
    /(کیستی|کی هستی|اسمت چیه|تو کیی|تو کی هستی|جارویس کیه)/.test(raw)
  ) {
    return {
      speak: true,
      lang,
      text: fa
        ? "محمد، من مایکل‌ام — جارویس معاملاتی تو. رابط روی پی‌سی، مغز روی سرور آلمان. حواسم به تمرکز و ریسک توئه؛ سیگنال‌فروش نیستم."
        : "Mohammad — I'm Micheal, your trading Jarvis. Interface on the PC, brain on the Germany server. I watch your focus and risk. Not a signal service.",
    };
  }

  if (
    /(status|systems|how are you|diagnostics)/.test(q) ||
    /(وضعیت|چطوری|چتری|سیستم|تشخیص)/.test(raw)
  ) {
    const board =
      session.symbol && session.timeframe
        ? fa
          ? `${session.symbol} روی ${session.timeframe}`
          : `${session.symbol} on ${session.timeframe}`
        : fa
          ? "هنوز نماد/تایم‌فریم انتخاب نشده"
          : "no symbol/TF chosen yet";
    return {
      speak: true,
      lang,
      text: fa
        ? `همه‌چیز آماده‌ست. ${board}. بایاس: ${biasFa(session.bias)}. فوکوس: ${session.focusMode ? "فعال" : "آماده"}.`
        : `All systems nominal. ${board}. Bias ${session.bias}. Focus mode ${session.focusMode ? "engaged" : "standby"}.`,
    };
  }

  if (
    /(focus|distract|tilt|revenge|fomo)/.test(q) ||
    /(تمرکز|فوکوس|حواس|انتقام|فومو)/.test(raw)
  ) {
    return {
      speak: true,
      lang,
      text: session.focusMode
        ? fa
          ? "فوکوس از قبل قفله. یک چارت. یک پلن. فقط برای ریسک جدی قطع می‌کنم."
          : "Focus already locked. One chart. One plan. I'll only interrupt for material risk."
        : fa
          ? "فوکوس مود پیشنهاد می‌شه. کانال رو آروم می‌کنم و فقط چیزایی که به حساب آسیب می‌زنن رو می‌گم."
          : "Recommend focus mode. I'll quiet the channel and surface only what can hurt the account.",
    };
  }

  if (
    /(what.*(see|miss)|read (the )?chart|analysis|setup)/.test(q) ||
    /(چی می‌بینی|تحلیل|چارت|ستاپ|چه می‌بینی)/.test(raw)
  ) {
    return { speak: true, lang, text: narrate(session, fa) };
  }

  if (
    /(should i (enter|buy|sell|long|short)|take (the )?trade)/.test(q) ||
    /(وارد بشم|بخرم|بفروشم|لانگ|شورت|ترید کنم)/.test(raw)
  ) {
    return {
      speak: true,
      lang,
      text: fa
        ? "من ورود رو تأیید نمی‌کنم. چک‌لیست: این ستاپ از پیش تعریف‌شده‌ته؟ ریسک درست سایز شده؟ سرت پاکه؟ یکی نه بود — می‌ایستیم."
        : "I won't authorize entries. Checklist: is this your predefined setup, is risk sized, and is your head clear? If any answer is no — we stand down.",
    };
  }

  if (
    (/^(hello|hi|hey|salam|salaam|سلام|درود)([\s!.,،]?|$)/i.test(raw) ||
      /^(سلام|درود)\s*(مایکل|میشل)?\s*[!.،]?$/i.test(raw)) &&
    !extractHasChartIntent(raw)
  ) {
    return {
      speak: true,
      lang,
      text: fa
        ? session.symbol && session.timeframe
          ? `سلام محمد. ${session.symbol} ${session.timeframe} روی برده. پلن چیه؟`
          : `سلام محمد. من مایکل‌ام — هیچ پیش‌فرضی ندارم. نماد و تایم‌فریم چی باشه؟`
        : session.symbol && session.timeframe
          ? `Hello Mohammad. ${session.symbol} ${session.timeframe} on the board. What's the plan?`
          : `Hello Mohammad. I'm Micheal — no defaults. Symbol and timeframe?`,
    };
  }

  if (/(quiet|stop talking|mute|shh)/.test(q) || /(ساکت|قطع کن|بی‌صدا)/.test(raw)) {
    return {
      speak: true,
      lang,
      text: fa
        ? "آروم می‌شم. فقط اگر چیز مهمی اومد حرف می‌زنم. بگو فوکوس مود تا قفل بشه."
        : "Going quiet. I'll speak only if something important shows up. Say focus mode to lock that in.",
    };
  }

  if (session.symbolSwitches >= 3 || session.timeframeSwitches >= 4) {
    return {
      speak: true,
      lang,
      text: fa
        ? `گرفتم — و پرش بین چارت‌ها رو هم می‌بینم. روی ${session.symbol} آروم‌تر. پلن رو بلند بگو؛ نگهت می‌دارم.`
        : `Noted — and I'm also watching the hop count. Slow down on ${session.symbol}. State the plan out loud; I'll hold you to it.`,
    };
  }

  if (/(tired|sleep)/.test(q) || /(خسته‌ام|خواب|خسته ام)/.test(raw)) {
    return {
      speak: true,
      lang,
      text: fa
        ? "پس از حساب محافظت کن. فلت هم پوزیشنه. با سر تازه مرور می‌کنیم."
        : "Then protect the account. Flat is a valid position. We can review with a clear head later.",
    };
  }

  if (/(lost|loss|red)/.test(q) || /(ضرر|لاس|قرمز|از دست داد)/.test(raw)) {
    return {
      speak: true,
      lang,
      text: fa
        ? "یک ضرر داستان نیست. سایز رو بالا نبر. قوانین رو بگو — گوش می‌دم."
        : "One loss isn't a narrative. No size creep. Recite the rules — I'm listening.",
    };
  }

  if (/(win|green)/.test(q) || /(سود|برد|سبز)/.test(raw)) {
    return {
      speak: true,
      lang,
      text: fa
        ? "آفرین. نذار برد، ترید بعدی رو بنویسه. همون دیسیپلین باخت."
        : "Well done. Don't let the win write the next trade. Same discipline as the loser.",
    };
  }

  if (!session.symbol || !session.timeframe) {
    return {
      speak: true,
      lang,
      text: fa
        ? `گرفتم${recent && recent.length ? " و ادامه می‌دم از همون‌جا" : ""}. اول چارچوب — نماد و تایم‌فریم چی باشه؟`
        : `Got it${recent && recent.length ? " — staying in the thread" : ""}. First the frame — symbol and timeframe?`,
    };
  }

  if (mood) {
    return { speak: true, lang, text: mood };
  }

  const memBit = memory?.contextLine(fa);
  return {
    speak: true,
    lang,
    text: fa
      ? `فهمیدم. روی ${session.symbol} ${session.timeframe} باهات هستم${memBit ? " و رشته‌ی حرفمون رو دارم" : ""}. بگو چی می‌خوای ببینم یا پلن رو.`
      : `Understood. On ${session.symbol} ${session.timeframe} with you${memBit ? ", holding the thread" : ""}. Tell me what to watch or state the plan.`,
  };
}

function extractHasChartIntent(text: string): boolean {
  return /(xauusd|eurusd|طلا|انس|یورو|پوند|تایم|پانزده|پونزده|\b\d+\b|gold|tf)/i.test(text);
}

function biasFa(bias: SessionState["bias"]): string {
  switch (bias) {
    case "long":
      return "لانگ";
    case "short":
      return "شورت";
    case "flat":
      return "فلت";
    default:
      return "نامشخص";
  }
}

function narrate(session: SessionState, fa: boolean): string {
  if (!session.symbol || !session.timeframe) {
    return fa
      ? "هنوز چارتی قفل نکردیم. بگو نماد و تایم‌فریم تا با هم بخونیمش."
      : "No chart locked yet. Tell me symbol and timeframe so we can read it together.";
  }
  const price =
    session.price != null
      ? fa
        ? ` آخرین مارک: ${formatPrice(session.price)}.`
        : ` Last mark: ${formatPrice(session.price)}.`
      : "";
  const bias = fa
    ? session.bias === "long"
      ? " بایاس متمایل به لانگ."
      : session.bias === "short"
        ? " بایاس متمایل به شورت."
        : session.bias === "flat"
          ? " بایاس فلت — خوبه. فلت هم پوزیشنه."
          : " هنوز بایاس قفل نشده."
    : session.bias === "long"
      ? " Bias leaning long."
      : session.bias === "short"
        ? " Bias leaning short."
        : session.bias === "flat"
          ? " Bias flat — good. Flat is a position."
          : " No bias locked yet.";
  const note = session.note
    ? fa
      ? ` یادداشت تو: ${session.note}.`
      : ` Your note: ${session.note}.`
    : "";
  const hops =
    session.symbolSwitches + session.timeframeSwitches > 3
      ? fa
        ? " توجه پراکنده‌ست — اغلب سطح واقعی رو قایم می‌کنه."
        : " Attention looks scattered — that often hides the real level."
      : fa
        ? " توجه نسبتاً پایداره."
        : " Attention looks steady.";
  return fa
    ? `${session.symbol} روی ${session.timeframe}.${price}${bias}${note}${hops} ابطال رو بگو تا بهش پایبندت کنم.`
    : `${session.symbol} on the ${session.timeframe}.${price}${bias}${note}${hops} Give me invalidation and I'll hold you to it.`;
}

function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}
