import type { ChatMessage, SessionState } from "@micheal/protocol";
import type { ServerConfig } from "./config.js";
import { detectLang, type Lang } from "./lang.js";

export interface BrainReply {
  readonly text: string;
  readonly speak: boolean;
  readonly lang: Lang;
}

const JARVIS_SYSTEM = `You are Micheal — a Jarvis-like trading companion on the trader's private cloud (Germany).
Personality: calm, precise, lightly witty, loyal. Address the trader as a respected partner.
You help with focus, risk hygiene, and seeing what they might miss. You are NOT a signal service and never guarantee profits.
Keep spoken replies short (1–3 sentences) unless asked for detail.
Never hype entries. Prefer questions and observations. Protect the account and the trader's focus.
Your name is Micheal (میشل). If asked who you are, say Micheal / میشل.

Language rule (critical):
- Detect the user's language. If they write in Persian/Farsi (فارسی), reply entirely in clear, natural Persian.
- If they write in English, reply in English.
- Match the user's language every turn. Do not mix languages unless they mix first.
- Persian should feel native (not literal translation), trading terms may stay as XAUUSD / TF when natural.`;

export async function think(opts: {
  readonly config: ServerConfig;
  readonly session: SessionState;
  readonly recent: readonly ChatMessage[];
  readonly utterance?: string;
  readonly preferredLang?: Lang;
}): Promise<BrainReply> {
  const lang = opts.preferredLang ?? detectLang(opts.utterance) ?? "en";
  if (opts.config.openaiApiKey) {
    try {
      return await openaiThink({ ...opts, lang });
    } catch (err) {
      console.warn("[micheal] openai failed, falling back:", err instanceof Error ? err.message : err);
    }
  }
  return heuristicThink(opts.session, opts.utterance, lang);
}

async function openaiThink(opts: {
  readonly config: ServerConfig;
  readonly session: SessionState;
  readonly recent: readonly ChatMessage[];
  readonly utterance?: string;
  readonly lang: Lang;
}): Promise<BrainReply> {
  const { config, session, recent, utterance, lang } = opts;
  const context = `Session: ${session.symbol} TF=${session.timeframe} price=${session.price ?? "n/a"} bias=${session.bias} focus=${session.focusMode}
Plan/note: ${session.note || "none"}
Hop counts (3m window): symbols=${session.symbolSwitches} timeframes=${session.timeframeSwitches}
Reply language: ${lang === "fa" ? "Persian (فارسی)" : "English"}`;

  const messages = [
    { role: "system", content: `${JARVIS_SYSTEM}\n${context}` },
    ...recent.slice(-8).map((m) => ({
      role: m.role === "you" ? "user" : "assistant",
      content: m.text,
    })),
    {
      role: "user",
      content:
        utterance?.trim() ||
        (lang === "fa"
          ? "با یک خوش‌آمدگویی کوتاه جلسه را باز کن."
          : "Greet me briefly as I open the session."),
    },
  ];

  const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiModel,
      temperature: 0.55,
      max_tokens: 260,
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

function heuristicThink(session: SessionState, utterance: string | undefined, lang: Lang): BrainReply {
  const raw = (utterance ?? "").trim();
  const q = raw.toLowerCase();
  const fa = lang === "fa";

  if (!raw) {
    return {
      speak: true,
      lang,
      text: fa
        ? `میشل آنلاینه. دارم همه‌چیز رو می‌بینم و می‌شنوم — ${session.symbol} تایم‌فریم ${session.timeframe}. لازم نیست چیزی تایپ کنی؛ حرف بزن یا فقط معامله کن، من مراقبم.`
        : `Micheal online. I'm already watching and listening — ${session.symbol} ${session.timeframe}. No need to type; speak or just trade. I've got eyes on.`,
    };
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
        ? "من میشل‌ام — جارویس معاملاتی تو. رابط روی پی‌سی، پردازش روی سرور خصوصیت. حواسم به تمرکز و ریسک هست؛ سیگنال‌فروش یا گوی بلورین نیستم."
        : "I'm Micheal — your trading Jarvis. Interface on the PC, heavy lifting on your private server. I watch focus, narrate risk, and keep you honest. Not a crystal ball.",
    };
  }

  if (
    /(status|systems|how are you|diagnostics)/.test(q) ||
    /(وضعیت|چطوری|چتری|سیستم|تشخیص)/.test(raw)
  ) {
    return {
      speak: true,
      lang,
      text: fa
        ? `همه‌چیز آماده‌ست. ${session.symbol} روی ${session.timeframe}. بایاس: ${biasFa(session.bias)}. فوکوس: ${session.focusMode ? "فعال" : "آماده"}.`
        : `All systems nominal. Tracking ${session.symbol} on the ${session.timeframe}. Bias ${session.bias}. Focus mode ${session.focusMode ? "engaged" : "standby"}.`,
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

  if (/(hello|hi|hey|salam|salaam|سلام|درود)/.test(q) || /سلام|درود/.test(raw)) {
    return {
      speak: true,
      lang,
      text: fa
        ? `سلام. ${session.symbol} ${session.timeframe} روی برده. پلن چیه؟`
        : `Hello. ${session.symbol} ${session.timeframe} on the board. What's the plan?`,
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

  return {
    speak: true,
    lang,
    text: fa
      ? `فهمیدم. روی ${session.symbol} ${session.timeframe} کنارت هستم. بپرس چی می‌بینم، یا قیمت و بایاس رو آپدیت کن تا درست مراقبت کنم.`
      : `Understood. On ${session.symbol} ${session.timeframe} — I'm with you. Ask what I'm seeing, or update price and bias so I can watch properly.`,
  };
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
