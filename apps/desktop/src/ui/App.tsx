import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { SessionState } from "@micheal/protocol";
import { MichealCloud } from "@/cloud";
import { readConfig, saveToken } from "@/config";
import { createVoice } from "@/voice";
import "./styles.css";

const TIMEFRAMES = ["1", "5", "15", "60", "240", "D"] as const;
const PERSIAN_RE = /[\u0600-\u06FF]/;

function hasPersian(text: string): boolean {
  return PERSIAN_RE.test(text);
}

export function App() {
  const voice = useMemo(() => createVoice(), []);
  const initial = useMemo(() => readConfig(), []);
  const [tokenDraft, setTokenDraft] = useState(initial.token === "dev-token-change-me" ? "" : initial.token);
  const [tokenReady, setTokenReady] = useState(
    Boolean(initial.token && initial.token !== "dev-token-change-me"),
  );
  const [uiLang, setUiLang] = useState<"en" | "fa">("fa");
  const [cloudUrl] = useState(initial.url);

  const cloud = useMemo(() => {
    if (!tokenReady) return null;
    const cfg = readConfig();
    return new MichealCloud(cfg.url, cfg.token, (text) => voice.speak(text));
  }, [voice, tokenReady]);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  const orbClass = ["orb", state.speaking ? "speaking" : "", state.listening ? "listening" : ""]
    .filter(Boolean)
    .join(" ");

  const caption = state.listening
    ? fa
      ? "در حال شنیدن…"
      : "Listening…"
    : state.speaking
      ? fa
        ? "در حال صحبت…"
        : "Speaking…"
      : !state.connected
        ? fa
          ? "اتصال به مغز ابری…"
          : "Linking to cloud brain…"
        : session?.focusMode
          ? fa
            ? "فوکوس قفل است"
            : "Focus lock engaged"
          : fa
            ? "آماده"
            : "Standing by";

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

  const pushToTalk = async () => {
    if (!cloud || !voice.supported.stt) return;
    cloud.setListening(true);
    try {
      const text = await voice.listen(uiLang);
      cloud.setListening(false);
      if (hasPersian(text)) setUiLang("fa");
      cloud.chat(text);
    } catch {
      cloud.setListening(false);
    }
  };

  if (!tokenReady) {
    return (
      <div className="app gate" dir={fa ? "rtl" : "ltr"}>
        <div className="gate-card">
          <div className="brand-mark">MICHEAL</div>
          <p className="gate-copy">
            {fa
              ? "توکن ابری را وارد کن تا HUD زنده روی سرور آلمان وصل شود. لینک مرورگر همیشه آنلاین می‌ماند."
              : "Enter your cloud token to link the always-live Germany brain. Browser HUD stays online."}
          </p>
          <label className="field">
            <span>Token</span>
            <input
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="MICHEAL_TOKEN"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <p className="hint mono">{cloudUrl}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (!tokenDraft.trim()) return;
              saveToken(tokenDraft.trim());
              setTokenReady(true);
            }}
          >
            {fa ? "ورود به میشل" : "Enter Micheal"}
          </button>
          <div className="chips">
            <button type="button" className={`chip ${fa ? "on" : ""}`} onClick={() => setUiLang("fa")}>
              فارسی
            </button>
            <button type="button" className={`chip ${!fa ? "on" : ""}`} onClick={() => setUiLang("en")}>
              English
            </button>
          </div>
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
              ? "دستیار معاملاتی · حضور دسکتاپ · مغز ابری آلمان · فارسی/EN"
              : "TRADING ASSISTANT · DESKTOP PRESENCE · DE CLOUD BRAIN · FA/EN"}
          </div>
        </div>
        <div className="pills">
          <span className="pill">
            <span className={`dot ${state.live ? "on" : ""}`} />
            {state.live ? (fa ? "زنده" : "live") : fa ? "در حال وصل" : "linking"}
          </span>
          <span className="pill">
            <span className={`dot ${state.connected ? "on" : ""}`} />
            {state.connected ? (fa ? "ابر وصل" : "cloud linked") : fa ? "ابر قطع" : "cloud offline"}
          </span>
          <span className="pill">
            <span className={`dot ${state.status === "speaking" || state.status === "listening" ? "warn" : ""}`} />
            {state.status}
          </span>
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
              {session
                ? fa
                  ? `نظارت روی ${session.symbol} · ${session.timeframe}${session.price != null ? ` · ${session.price}` : ""}. صدا روی پی‌سی — قضاوت روی سرور آلمان.`
                  : `Watching ${session.symbol} · ${session.timeframe}${session.price != null ? ` · ${session.price}` : ""}. Voice on the PC — judgment on the Germany server.`
                : fa
                  ? "در حال اتصال به مغز ابری خصوصی…"
                  : "Connecting to your private cloud brain…"}
            </p>
          </div>
        </section>

        <aside className="side">
          <section className="panel">
            <h3>{fa ? "فید جلسه" : "Session feed"}</h3>
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
            <h3>{fa ? "کانال" : "Channel"}</h3>
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
                placeholder={fa ? "با میشل حرف بزن…" : "Talk to Micheal…"}
                aria-label="Message"
                dir={hasPersian(draft) ? "rtl" : "auto"}
              />
              <button
                type="button"
                className={`btn ghost mic ${state.listening ? "on" : ""}`}
                onClick={() => void pushToTalk()}
                disabled={!voice.supported.stt}
              >
                {fa ? "میک" : "Mic"}
              </button>
              <button type="submit" className="btn">
                {fa ? "ارسال" : "Send"}
              </button>
            </form>
            <p className="hint">
              {fa
                ? "پی‌سی: صدا + HUD · ابر (آلمان): مغز + حافظه · مرورگر همیشه زنده · Chrome/Edge برای میک"
                : "PC: voice + HUD · Cloud (DE): brain + memory · Browser always live · Chrome/Edge for mic"}
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}
