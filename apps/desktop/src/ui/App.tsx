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

export function App() {
  const voice = useMemo(() => createVoice(), []);
  const [cfg, setCfg] = useState<{ url: string; token: string } | null>(null);
  const [, setUiLang] = useState<"en" | "fa">("fa");
  const [heard, setHeard] = useState("");
  const [micMsg, setMicMsg] = useState<string | null>(null);
  const [micArmed, setMicArmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);
  const busyRef = useRef(false);

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

  useEffect(() => {
    if (!cloud) return;
    cloud.connect();
    return () => cloud.disconnect();
  }, [cloud]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  const boardReady = Boolean(session?.symbol && session?.timeframe);
  const orbClass = ["orb", state.speaking ? "speaking" : "", recording || transcribing ? "listening" : ""]
    .filter(Boolean)
    .join(" ");

  const caption = !state.connected
    ? "اتصال به مغز ابری…"
    : state.speaking
      ? "در حال صحبت…"
      : transcribing
        ? "در حال فهمیدن صدا…"
        : recording
          ? "دارم ضبط می‌کنم — دوباره بزن تا بفرستم"
          : "آماده — دکمه میک را بزن و حرف بزن";

  const armMic = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
      setMicArmed(true);
      setMicMsg(null);
      return true;
    } catch {
      setMicArmed(false);
      setMicMsg(
        "ویندوز میکروفون را بسته. Settings → Privacy & security → Microphone → Micheal / Desktop apps را روشن کن، بعد دوباره بزن.",
      );
      return false;
    }
  };

  const toggleTalk = async () => {
    if (!cloud || busyRef.current || transcribing) return;
    if (!voice.supported.media) {
      setMicMsg("این محیط ضبط صدا ندارد. از کامپیوتر ویندوز با اپ جدید استفاده کن.");
      return;
    }

    if (!recording) {
      const ok = micArmed || (await armMic());
      if (!ok) return;
      try {
        await voice.startRecording((lv) => setLevel(lv));
        setRecording(true);
        cloud.setListening(true);
        setHeard("");
        setMicMsg("حرف بزن… وقتی تموم شد دوباره همین دکمه را بزن.");
      } catch (err) {
        setMicMsg(err instanceof Error ? err.message : "شروع ضبط نشد");
        setRecording(false);
        cloud.setListening(false);
      }
      return;
    }

    // Stop → upload → chat
    busyRef.current = true;
    setRecording(false);
    setTranscribing(true);
    cloud.setListening(false);
    setMicMsg("دارم صدایت را می‌فرستم به آلمان…");
    try {
      const blob = await voice.stopRecording();
      setLevel(0);
      if (!blob.size || blob.size < 800) {
        setMicMsg("خیلی کوتاه بود — دوباره بزن، یک‌ثانیه حرف بزن، بعد دوباره بزن.");
        return;
      }
      const text = await cloud.transcribe(blob, "fa");
      if (!text) {
        setMicMsg("چیزی نفهمیدم — واضح‌تر و کمی بلندتر بگو.");
        return;
      }
      setHeard(text);
      setMicMsg(null);
      setUiLang("fa");
      cloud.chat(text);
    } catch (err) {
      setMicMsg(
        err instanceof Error
          ? `میک/STT: ${err.message}`
          : "ارسال صدا شکست خورد — اتصال به سرور را چک کن.",
      );
    } finally {
      setTranscribing(false);
      busyRef.current = false;
    }
  };

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
          <div className="brand-sub">جارویس معاملاتی · میک واقعی · فارسی</div>
        </div>
        <div className="pills">
          <span className="pill">
            <span className={`dot ${state.live ? "on" : ""}`} />
            {state.live ? "زنده" : "وصل…"}
          </span>
          <span className="pill">
            <span className={`dot ${recording || transcribing ? "warn" : micArmed ? "on" : ""}`} />
            {transcribing ? "فهم صدا" : recording ? "ضبط" : micArmed ? "میک آماده" : "میک قطع"}
          </span>
          <button type="button" className="chip" onClick={() => void armMic()}>
            فعال‌سازی میک
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
                  ? `با هم روی ${session!.symbol} · ${session!.timeframe}. دکمه میک = ضبط واقعی (نه Web Speech شکسته).`
                  : "هیچ پیش‌فرضی نیست. میک را بزن و بگو مثلاً «طلا پانزده»."}
            </p>
            <div className="level" aria-hidden>
              <div className="level-fill" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <button
              type="button"
              className={`btn talk ${recording ? "on" : ""} ${transcribing ? "busy" : ""}`}
              onClick={() => void toggleTalk()}
              disabled={!connected || transcribing}
            >
              {transcribing
                ? "…در حال فهمیدن"
                : recording
                  ? "توقف و ارسال"
                  : "بزن و حرف بزن"}
            </button>
            {micMsg ? <p className="hint danger">{micMsg}</p> : null}
            <p className="hint">
              یک‌بار بزن → حرف بزن (نوار سبز باید حرکت کند) → دوباره بزن تا بفرستد. اگر نوار حرکت نکرد، میک ویندوز بسته است.
            </p>
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
          </section>
        </aside>
      </main>
    </div>
  );
}
