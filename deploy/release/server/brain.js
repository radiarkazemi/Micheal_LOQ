const JARVIS_SYSTEM = `You are Micheal — a Jarvis-like trading companion running on the trader's private cloud.
Personality: calm, precise, lightly witty, loyal. Address the trader as a respected partner (occasional "sir" is fine, never servile).
You help with focus, risk hygiene, and seeing what they might miss. You are NOT a signal service and you never guarantee profits.
Keep spoken replies short (1–3 sentences) unless asked for detail.
Never hype entries. Prefer questions and observations. Protect the account and the trader's focus.
Your name is Micheal. If asked who you are, say Micheal.`;
export async function think(opts) {
    if (opts.config.openaiApiKey) {
        try {
            return await openaiThink(opts);
        }
        catch (err) {
            console.warn("[micheal] openai failed, falling back:", err instanceof Error ? err.message : err);
        }
    }
    return heuristicThink(opts.session, opts.utterance);
}
async function openaiThink(opts) {
    const { config, session, recent, utterance } = opts;
    const context = `Session: ${session.symbol} TF=${session.timeframe} price=${session.price ?? "n/a"} bias=${session.bias} focus=${session.focusMode}
Plan/note: ${session.note || "none"}
Hop counts (3m window): symbols=${session.symbolSwitches} timeframes=${session.timeframeSwitches}`;
    const messages = [
        { role: "system", content: `${JARVIS_SYSTEM}\n${context}` },
        ...recent.slice(-8).map((m) => ({
            role: m.role === "you" ? "user" : "assistant",
            content: m.text,
        })),
        { role: "user", content: utterance?.trim() || "Greet me briefly as I open the session." },
    ];
    const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.openaiApiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: config.openaiModel,
            temperature: 0.6,
            max_tokens: 220,
            messages,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json());
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text)
        throw new Error("empty completion");
    return { text, speak: true };
}
function heuristicThink(session, utterance) {
    const q = (utterance ?? "").trim().toLowerCase();
    if (!q) {
        return {
            speak: true,
            text: `Good to see you. Micheal online — cloud brain in Germany, presence on your desk. We're on ${session.symbol} ${session.timeframe}. How shall we proceed?`,
        };
    }
    if (/(who are you|what are you|jarvis|your name|micheal|michael)/.test(q)) {
        return {
            speak: true,
            text: "I'm Micheal — your trading Jarvis. Interface on the PC, heavy lifting on your private server. I watch focus, narrate risk, and keep you honest. Not a crystal ball.",
        };
    }
    if (/(status|systems|how are you|diagnostics)/.test(q)) {
        return {
            speak: true,
            text: `All systems nominal. Tracking ${session.symbol} on the ${session.timeframe}. Bias ${session.bias}. Focus mode ${session.focusMode ? "engaged" : "standby"}.`,
        };
    }
    if (/(focus|distract|tilt|revenge|fomo)/.test(q)) {
        return {
            speak: true,
            text: session.focusMode
                ? "Focus already locked. One chart. One plan. I'll only interrupt for material risk."
                : "Recommend focus mode. I'll quiet the channel and surface only what can hurt the account.",
        };
    }
    if (/(what.*(see|miss)|read (the )?chart|analysis|setup)/.test(q)) {
        return { speak: true, text: narrate(session) };
    }
    if (/(should i (enter|buy|sell|long|short)|take (the )?trade)/.test(q)) {
        return {
            speak: true,
            text: "I won't authorize entries. Checklist: is this your predefined setup, is risk sized, and is your head clear? If any answer is no — we stand down.",
        };
    }
    if (/(hello|hi|hey|salam|سلام)/.test(q)) {
        return {
            speak: true,
            text: `Hello. ${session.symbol} ${session.timeframe} on the board. What's the plan?`,
        };
    }
    if (/(quiet|stop talking|mute|shh)/.test(q)) {
        return {
            speak: true,
            text: "Going quiet. I'll speak only if something important shows up. Say focus mode to lock that in.",
        };
    }
    if (session.symbolSwitches >= 3 || session.timeframeSwitches >= 4) {
        return {
            speak: true,
            text: `Noted — and I'm also watching the hop count. Slow down on ${session.symbol}. State the plan out loud; I'll hold you to it.`,
        };
    }
    if (/(tired|sleep)/.test(q)) {
        return {
            speak: true,
            text: "Then protect the account. Flat is a valid position. We can review with a clear head later.",
        };
    }
    if (/(lost|loss|red)/.test(q)) {
        return {
            speak: true,
            text: "One loss isn't a narrative. No size creep. Recite the rules — I'm listening.",
        };
    }
    if (/(win|green)/.test(q)) {
        return {
            speak: true,
            text: "Well done. Don't let the win write the next trade. Same discipline as the loser.",
        };
    }
    return {
        speak: true,
        text: `Understood. On ${session.symbol} ${session.timeframe} — I'm with you. Ask what I'm seeing, or update price and bias so I can watch properly.`,
    };
}
function narrate(session) {
    const price = session.price != null ? ` Last mark: ${formatPrice(session.price)}.` : "";
    const bias = session.bias === "long"
        ? " Bias leaning long."
        : session.bias === "short"
            ? " Bias leaning short."
            : session.bias === "flat"
                ? " Bias flat — good. Flat is a position."
                : " No bias locked yet.";
    const note = session.note ? ` Your note: ${session.note}.` : "";
    const hops = session.symbolSwitches + session.timeframeSwitches > 3
        ? " Attention looks scattered — that often hides the real level."
        : " Attention looks steady.";
    return `${session.symbol} on the ${session.timeframe}.${price}${bias}${note}${hops} Give me invalidation and I'll hold you to it.`;
}
function formatPrice(n) {
    if (n >= 1000)
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (n >= 1)
        return n.toFixed(4);
    return n.toPrecision(4);
}
