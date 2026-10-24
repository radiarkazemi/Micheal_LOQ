import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { SessionState } from "@micheal/protocol";
import { MichealCloud } from "@/cloud";
import { loadConfig } from "@/config";
import { createVoice } from "@/voice";
import "./styles.css";

const TIMEFRAMES = ["1", "5", "15", "60", "240", "D"] as const;
const PERSIAN_RE = /[\u0600-\u06FF]/;

function hasPersian(text: string): boolean {
  return PERSIAN_RE.test(text);
}

export function App() {
  const voice = useMemo(() => createVoice(), []);
  const [cfg, setCfg] = useState<{ url: string; token: string } | null>(null);
  const [uiLang, setUiLang] = useState<"en" | "fa">("fa");
  const [ambientOn, setAmbientOn] = useState(true);
  const [ears, setEars] = useState(false);
  const [heard, setHeard] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadConfig().then((c) => {
      if (!cancelled) setCfg(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cloud = useMemo(() => {
    if (!cfg?.token) return null;
    return new MichealCloud(cfg.url, cfg.token, (text) => voice.speak(text));
  }, [voice, cfg]);

  const state = useSyncExternalStore(
    (cb) => (cloud ? cloud.subscribe(cb) : () => undefined),
    () =>
      cloud?.getState() ?? {
        connected: false,
        status: "offline",
        session: null,
        messages: [],
        speaking: false,
        listening: false,
        voiceEnabled: true,
        live: false,
      },
    () =>
      cloud?.getState() ?? {
        connected: false,
        status: "offline",
        session: null,
        messages: [],
        speaking: false,
        listening: false,
        voiceEnabled: true,
        live: false,
      },
  );

  const [draft, setDraft] = useState("");
  const [priceDraft, setPriceDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const session = state.session;
  const fa = uiLang === "fa";
  const rtlChat = hasPersian(draft) || state.messages.some((m) => hasPersian(m.text));

  useEffect(() => {
    voice.setListenLang(uiLang);
  }, [voice, uiLang]);

  useEffect(() => {
    if (!cloud) return;
    cloud.connect();
    return () => cloud.disconnect();
  }, [cloud]);

  // Always-on ears — no click required (Jarvis listens)
  useEffect(() => {
    if (!cloud || !ambientOn || !voice.supported.stt || !state.connected) {
      voice.stopAmbient();
      setEars(false);
      return;
    }
    voice.startAmbient({
      lang: uiLang,
      onListening: setEars,
      onPartial: setHeard,
      onPhrase: (text) => {
        setHeard("");
        if (hasPersian(text)) setUiLang("fa");
        cloud.chat(text);
      },
    });
    return () => voice.stopAmbient();
  }, [cloud, ambientOn, voice, uiLang, state.connected]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  const orbClass = [
    "orb",
    state.speaking ? "speaking" : "",
    state.listening || ears ? "listening" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const caption = state.speaking
    ? fa
      ? "در حال صحبت…"
      : "Speaking…"
    : ears || state.listening
      ? fa
        ? "دارم می‌شنوم و می‌فهمم…"
        : "Hearing & understanding…"
      : !state.connected
        ? fa
          ? "اتصال به مغز ابری…"
          : "Linking to cloud brain…"
        : session?.focusMode
          ? fa
            ? "فوکوس قفل — دارم می‌بینم"
            : "Focus lock — still watching"
          : fa
            ? "دارم همه‌چیز رو می‌بینم"
            : "Watching everything";

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !cloud) return;
    if (hasPersian(text)) setUiLang("fa");
    setDraft("");
    cloud.chat(text);
  };

  const applyPrice = () => {
    if (!cloud) return;
    const raw = priceDraft.trim();
    if (!raw) {
      cloud.patchSession({ price: null });
      return;
    }
    const n = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(n)) cloud.patchSession({ price: n });
  };

  if (!cfg) {
    return (
      <div className="app gate" dir="rtl">
        <div className="gate-card">
          <div className="brand-mark">MICHEAL</div>
          <p className="gate-copy">در حال بیدار شدن… مثل جارویس، بدون ورودی.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app" dir={fa ? "rtl" : "ltr"}>
      <header className="topbar">
        <div>
          <div className="brand-mark">MICHEAL</div>
          <div className="brand-sub">
            {fa
              ? "جارویس معاملاتی · همیشه بیدار · می‌بیند و می‌فهمد · فارسی/EN"
              : "TRADING JARVIS · ALWAYS AWAKE · SEES & UNDERSTANDS · FA/EN"}
          </div>
        </div>
        <div className="pills">
          <span className="pill">
            <span className={`dot ${state.live ? "on" : ""}`} />
            {state.live ? (fa ? "زنده" : "live") : fa ? "وصل…" : "linking"}
          </span>
          <span className="pill">
            <span className={`dot ${ears ? "warn" : state.connected ? "on" : ""}`} />
            {ears ? (fa ? "گوش فعال" : "ears on") : state.connected ? (fa ? "چشم باز" : "eyes open") : fa ? "آفلاین" : "offline"}
          </span>
          <button type="button" className={`chip ${ambientOn ? "on" : ""}`} onClick={() => setAmbientOn((v) => !v)}>
            {fa ? (ambientOn ? "شنود دائم" : "شنود خاموش") : ambientOn ? "Always listen" : "Listen off"}
          </button>
          <button type="button" className={`chip ${fa ? "on" : ""}`} onClick={() => setUiLang(fa ? "en" : "fa")}>
            {fa ? "EN" : "FA"}
          </button>
        </div>
      </header>

      <main className="stage">
        <section className="hud" aria-label="Micheal presence">
          <div className="orb-wrap">
            <div className={orbClass} aria-hidden>
              <div className="ring" />
              <div className="ring outer" />
            </div>
          </div>
          <div className="caption">
            <h2>{caption}</h2>
            <p>
              {heard
                ? fa
                  ? `شنیدم: ${heard}`
                  : `Hearing: ${heard}`
                : session
                  ? fa
                    ? `مراقب ${session.symbol} · ${session.timeframe}${session.price != null ? ` · ${session.price}` : ""}. لازم نیست کلیک کنی — حرف بزن یا فقط کار کن.`
                    : `On ${session.symbol} · ${session.timeframe}${session.price != null ? ` · ${session.price}` : ""}. No clicks needed — speak or just work.`
                  : fa
                    ? "مغز ابری در حال همگام‌سازی…"
                    : "Cloud brain syncing…"}
            </p>
          </div>
        </section>

        <aside className="side">
          <section className="panel">
            <h3>{fa ? "فید جلسه (خودکار دیده می‌شود)" : "Session feed (auto-watched)"}</h3>
            <div className="grid2">
              <div className="field">
                <label htmlFor="symbol">{fa ? "نماد" : "Symbol"}</label>
                <input
                  id="symbol"
                  value={session?.symbol ?? ""}
                  onChange={(e) => cloud?.patchSession({ symbol: e.target.value })}
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label htmlFor="tf">{fa ? "تایم‌فریم" : "Timeframe"}</label>
                <select
                  id="tf"
                  value={session?.timeframe ?? "15"}
                  onChange={(e) => cloud?.patchSession({ timeframe: e.target.value })}
                >
                  {TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="price">{fa ? "مارک قیمت" : "Price mark"}</label>
                <input
                  id="price"
                  value={priceDraft}
                  placeholder="e.g. 2345.5"
                  onChange={(e) => setPriceDraft(e.target.value)}
                  onBlur={applyPrice}
                  onKeyDown={(e) => e.key === "Enter" && applyPrice()}
                />
              </div>
              <div className="field">
                <label htmlFor="bias">{fa ? "بایاس" : "Bias"}</label>
                <select
                  id="bias"
                  value={session?.bias ?? "unknown"}
                  onChange={(e) => cloud?.patchSession({ bias: e.target.value as SessionState["bias"] })}
                >
                  <option value="unknown">{fa ? "نامشخص" : "unknown"}</option>
                  <option value="long">{fa ? "لانگ" : "long"}</option>
                  <option value="short">{fa ? "شورت" : "short"}</option>
                  <option value="flat">{fa ? "فلت" : "flat"}</option>
                </select>
              </div>
              <div className="field span2">
                <label htmlFor="note">{fa ? "پلن / ابطال" : "Plan / invalidation"}</label>
                <textarea
                  id="note"
                  value={session?.note ?? ""}
                  placeholder={fa ? "ابطال زیر سوئینگ لو…" : "Invalid below swing low…"}
                  onChange={(e) => cloud?.patchSession({ note: e.target.value })}
                />
              </div>
            </div>
            <div className="chips">
              <button
                type="button"
                className={`chip ${session?.focusMode ? "on" : ""}`}
                onClick={() => cloud?.patchSession({ focusMode: !session?.focusMode })}
              >
                {fa ? "فوکوس" : "Focus mode"}
              </button>
              <button
                type="button"
                className={`chip ${state.voiceEnabled ? "on" : ""}`}
                onClick={() => {
                  const next = !state.voiceEnabled;
                  voice.setEnabled(next);
                  cloud?.setVoiceEnabled(next);
                }}
              >
                {fa ? (state.voiceEnabled ? "صدا روشن" : "صدا خاموش") : `Voice ${state.voiceEnabled ? "on" : "off"}`}
              </button>
            </div>
          </section>

          <section className="panel transcript">
            <h3>{fa ? "کانال زنده" : "Live channel"}</h3>
            <div className={`scroll ${rtlChat ? "rtl-text" : ""}`} ref={scrollRef}>
              {state.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.role}`} dir={hasPersian(m.text) ? "rtl" : "ltr"}>
                  <span className="meta">
                    {m.role === "micheal" ? "MICHEAL" : m.role === "you" ? (fa ? "تو" : "YOU") : "SYS"}
                    {m.spoken ? (fa ? " · صوتی" : " · voiced") : ""}
                  </span>
                  {m.text}
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <form className="composer" onSubmit={onSubmit}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={fa ? "اختیاری — معمولاً فقط حرف بزن" : "Optional — usually just speak"}
                aria-label="Message"
                dir={hasPersian(draft) ? "rtl" : "auto"}
              />
              <button type="submit" className="btn">
                {fa ? "ارسال" : "Send"}
              </button>
            </form>
            <p className="hint">
              {fa
                ? "بدون ورود توکن · شنود دائم · آگاهی خودکار از جلسه · Chrome/Edge برای میک"
                : "No token typing · always listening · auto session awareness · Chrome/Edge for mic"}
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}
