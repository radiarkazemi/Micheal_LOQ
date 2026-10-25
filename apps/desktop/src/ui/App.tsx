import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { SessionState } from "@micheal/protocol";
import { MichealCloud } from "@/cloud";
import { loadConfig } from "@/config";
import { createVoice } from "@/voice";
import "./styles.css";

const TIMEFRAMES = ["1", "5", "15", "60", "240", "D"] as const;
const PERSIAN_RE = /[\u0600-\u06FF]/;

const EMPTY_STATE = {
  connected: false,
  status: "offline",
  session: null,
  messages: [] as const,
  speaking: false,
  listening: false,
  voiceEnabled: true,
  live: false,
};

function hasPersian(text: string): boolean {
  return PERSIAN_RE.test(text);
}

async function armMicrophone(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "مرورگر/اپ به میک دسترسی ندارد.";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Keep track briefly then release — SpeechRecognition opens its own stream
    for (const t of stream.getTracks()) t.stop();
    return null;
  } catch {
    return "دسترسی میکروفون بسته است. در ویندوز: Settings → Privacy → Microphone → اجازه به Micheal.";
  }
}

export function App() {
  const voice = useMemo(() => createVoice(), []);
  const [cfg, setCfg] = useState<{ url: string; token: string } | null>(null);
  const [, setUiLang] = useState<"en" | "fa">("fa");
  const [ambientOn, setAmbientOn] = useState(true);
  const [ears, setEars] = useState(false);
  const [heard, setHeard] = useState("");
  const [micMsg, setMicMsg] = useState<string | null>(null);
  const [micArmed, setMicArmed] = useState(false);
  const [holding, setHolding] = useState(false);

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
    () => cloud?.getState() ?? EMPTY_STATE,
    () => EMPTY_STATE,
  );

  const [draft, setDraft] = useState("");
  const [priceDraft, setPriceDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const session = state.session;
  const rtlChat = hasPersian(draft) || state.messages.some((m) => hasPersian(m.text));
  const connected = state.connected;
  const busyRef = useRef(false);

  // Ask Windows/Electron for mic as soon as cloud is up
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void armMicrophone().then((err) => {
      if (cancelled) return;
      setMicMsg(err);
      setMicArmed(!err);
    });
    return () => {
      cancelled = true;
    };
  }, [connected]);

  useEffect(() => {
    voice.setListenLang("fa");
  }, [voice]);

  useEffect(() => {
    if (!cloud) return;
    cloud.connect();
    return () => cloud.disconnect();
  }, [cloud]);

  useEffect(() => {
    if (!cloud || !ambientOn || !voice.supported.stt || !connected || !micArmed) {
      voice.stopAmbient();
      setEars(false);
      return;
    }
    voice.setListenLang("fa");
    voice.startAmbient({
      lang: "fa",
      onListening: (on) => setEars(on),
      onPartial: setHeard,
      onPhrase: (text) => {
        if (busyRef.current) return;
        const t = text.trim();
        if (t.length < 2) return;
        setHeard("");
        setUiLang("fa");
        busyRef.current = true;
        cloud.chat(t);
        window.setTimeout(() => {
          busyRef.current = false;
        }, 2500);
      },
    });
    return () => voice.stopAmbient();
  }, [cloud, ambientOn, voice, connected, micArmed]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  const orbClass = [
    "orb",
    state.speaking ? "speaking" : "",
    holding || (ambientOn && connected && micArmed) ? "listening" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const boardReady = Boolean(session?.symbol && session?.timeframe);
  const caption = !state.connected
    ? "اتصال به مغز ابری…"
    : state.speaking
      ? "در حال صحبت…"
      : holding
        ? "بگو… دارم گوش می‌دم"
        : !micArmed
          ? "میکروفون لازم است"
          : ambientOn
            ? "مراقب و شنوا"
            : "مراقب (شنود خاموش)";

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !cloud) return;
    setUiLang("fa");
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

  const holdTalk = async () => {
    if (!cloud || !voice.supported.stt) return;
    if (!micArmed) {
      const err = await armMicrophone();
      setMicMsg(err);
      setMicArmed(!err);
      if (err) return;
    }
    setHolding(true);
    voice.setPaused(true);
    cloud.setListening(true);
    try {
      const text = await voice.listen("fa");
      setHolding(false);
      cloud.setListening(false);
      voice.setPaused(false);
      if (text.trim()) {
        setUiLang("fa");
        cloud.chat(text.trim());
      }
    } catch {
      setHolding(false);
      cloud.setListening(false);
      voice.setPaused(false);
    }
  };

  if (!cfg) {
    return (
      <div className="app gate" dir="rtl">
        <div className="gate-card">
          <div className="brand-mark">MICHEAL</div>
          <p className="gate-copy">در حال بیدار شدن…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app" dir="rtl">
      <header className="topbar">
        <div>
          <div className="brand-mark">MICHEAL</div>
          <div className="brand-sub">جارویس معاملاتی · با هم انتخاب می‌کنیم · فارسی</div>
        </div>
        <div className="pills">
          <span className="pill">
            <span className={`dot ${state.live ? "on" : ""}`} />
            {state.live ? "زنده" : "وصل…"}
          </span>
          <span className="pill">
            <span className={`dot ${micArmed ? (ears || holding ? "warn" : "on") : ""}`} />
            {!micArmed ? "میک قطع" : holding ? "گوش دادن" : ears ? "شنوا" : "آماده"}
          </span>
          <button type="button" className={`chip ${ambientOn ? "on" : ""}`} onClick={() => setAmbientOn((v) => !v)}>
            {ambientOn ? "شنود دائم" : "شنود خاموش"}
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
                ? `شنیدم: ${heard}`
                : boardReady
                  ? `با هم روی ${session!.symbol} · ${session!.timeframe}${session!.price != null ? ` · ${session!.price}` : ""}. حرف بزن یا دکمه میک را نگه دار.`
                  : "هیچ پیش‌فرضی نیست. بگو چه نماد و تایم‌فریمی — مثلاً «طلا پانزده»."}
            </p>
            <button
              type="button"
              className={`btn talk ${holding ? "on" : ""}`}
              onMouseDown={() => void holdTalk()}
              onTouchStart={() => void holdTalk()}
              disabled={!connected}
            >
              {holding ? "…در حال شنیدن" : "نگه دار و حرف بزن"}
            </button>
            {micMsg ? <p className="hint danger">{micMsg}</p> : null}
            {!voice.supported.stt ? (
              <p className="hint danger">تشخیص گفتار در این محیط پشتیبانی نمی‌شود — متن بفرست یا اپ جدید را نصب کن.</p>
            ) : null}
          </div>
        </section>

        <aside className="side">
          <section className="panel">
            <h3>فید جلسه — با هم می‌چینیم</h3>
            <div className="grid2">
              <div className="field">
                <label htmlFor="symbol">نماد</label>
                <input
                  id="symbol"
                  value={session?.symbol ?? ""}
                  placeholder="هنوز انتخاب نشده"
                  onChange={(e) => cloud?.patchSession({ symbol: e.target.value })}
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label htmlFor="tf">تایم‌فریم</label>
                <select
                  id="tf"
                  value={session?.timeframe ?? ""}
                  onChange={(e) => cloud?.patchSession({ timeframe: e.target.value })}
                >
                  <option value="">انتخاب نشده</option>
                  {TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="price">مارک قیمت</label>
                <input
                  id="price"
                  value={priceDraft}
                  placeholder="مثلاً 2345.5"
                  onChange={(e) => setPriceDraft(e.target.value)}
                  onBlur={applyPrice}
                  onKeyDown={(e) => e.key === "Enter" && applyPrice()}
                />
              </div>
              <div className="field">
                <label htmlFor="bias">بایاس</label>
                <select
                  id="bias"
                  value={session?.bias ?? "unknown"}
                  onChange={(e) => cloud?.patchSession({ bias: e.target.value as SessionState["bias"] })}
                >
                  <option value="unknown">نامشخص</option>
                  <option value="long">لانگ</option>
                  <option value="short">شورت</option>
                  <option value="flat">فلت</option>
                </select>
              </div>
              <div className="field span2">
                <label htmlFor="note">پلن / ابطال</label>
                <textarea
                  id="note"
                  value={session?.note ?? ""}
                  placeholder="با هم می‌نویسیم…"
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
                فوکوس
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
                {state.voiceEnabled ? "صدا روشن" : "صدا خاموش"}
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  void armMicrophone().then((err) => {
                    setMicMsg(err);
                    setMicArmed(!err);
                  });
                }}
              >
                فعال‌سازی میک
              </button>
            </div>
          </section>

          <section className="panel transcript">
            <h3>کانال زنده</h3>
            <div className={`scroll ${rtlChat ? "rtl-text" : ""}`} ref={scrollRef}>
              {state.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.role}`} dir={hasPersian(m.text) ? "rtl" : "ltr"}>
                  <span className="meta">
                    {m.role === "micheal" ? "MICHEAL" : m.role === "you" ? "تو" : "SYS"}
                    {m.spoken ? " · صوتی" : ""}
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
                placeholder="یا اینجا بنویس — مثلاً طلا پانزده"
                aria-label="Message"
                dir="rtl"
              />
              <button type="submit" className="btn">
                ارسال
              </button>
            </form>
            <p className="hint">میک را یک‌بار اجازه بده · دکمه «نگه دار و حرف بزن» مطمئن‌ترین راه است · جواب‌ها فارسی</p>
          </section>
        </aside>
      </main>
    </div>
  );
}
