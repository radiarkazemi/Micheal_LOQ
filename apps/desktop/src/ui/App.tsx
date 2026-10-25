import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { SessionState } from "@micheal/protocol";
import { MichealCloud } from "@/cloud";
import { loadConfig } from "@/config";
import { createVoice } from "@/voice";
import { WakeGate } from "@/wake";
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

function isNoiseTranscript(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return true;
  // Whisper hallucinations on silence / noise
  if (/^(thank you|thanks|you|the end|subtitle|subscribe|\.+|…+)$/i.test(t)) return true;
  if (/^(موسیقی|زیرنویس|تشکر)$/i.test(t)) return true;
  return false;
}

export function App() {
  const voice = useMemo(() => createVoice(), []);
  const wake = useMemo(() => new WakeGate(75_000), []);
  const [cfg, setCfg] = useState<{ url: string; token: string } | null>(null);
  const [heard, setHeard] = useState("");
  const [micMsg, setMicMsg] = useState<string | null>(null);
  const [earsOn, setEarsOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<"boot" | "listening" | "thinking" | "speaking" | "sleep">("boot");
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const cloudRef = useRef<MichealCloud | null>(null);

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
    const c = new MichealCloud(cfg.url, cfg.token, async (text) => {
      setPhase("speaking");
      voice.setPaused(true);
      await voice.speak(text, {
        cloudSpeak: (t, lang) => c.fetchSpeech(t, lang),
      });
      voice.setPaused(false);
      wake.keepAlive();
      setPhase(wake.isConversationOpen ? "listening" : "sleep");
    });
    cloudRef.current = c;
    return c;
  }, [voice, cfg, wake]);

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
    speakingRef.current = state.speaking;
  }, [state.speaking]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  // Always-on Jarvis ears once connected
  useEffect(() => {
    if (!cloud || !connected || !voice.supported.media) return;
    let cancelled = false;

    const start = async () => {
      try {
        await voice.startJarvisEars({
          onLevel: setLevel,
          shouldListen: () => !busyRef.current && !speakingRef.current && !voice.isPaused(),
          onUtterance: async (blob) => {
            if (cancelled || busyRef.current) return;
            busyRef.current = true;
            voice.setPaused(true);
            setPhase("thinking");
            cloud.setListening(true);
            try {
              const text = await cloud.transcribe(blob, "auto");
              if (isNoiseTranscript(text)) {
                setMicMsg(null);
                return;
              }
              setHeard(text);
              const gate = wake.handle(text);
              if (!gate.awake) {
                setMicMsg(`شنیدم ولی بیدار نیستم — بگو «هی میشل» / Hey Micheal`);
                setPhase("sleep");
                return;
              }
              if (gate.wokeNow && !gate.command) {
                setMicMsg(null);
                cloud.chat(hasPersian(text) ? "سلام میشل" : "Hey Micheal");
                return;
              }
              setMicMsg(null);
              setPhase("thinking");
              cloud.chat(gate.command || text);
            } catch (err) {
              setMicMsg(err instanceof Error ? err.message : "خطای شنود");
            } finally {
              cloud.setListening(false);
              // keep paused until TTS speak path clears it; if no speak, clear
              window.setTimeout(() => {
                if (!cloudRef.current?.getState().speaking) {
                  voice.setPaused(false);
                  busyRef.current = false;
                  setPhase(wake.isConversationOpen ? "listening" : "sleep");
                } else {
                  busyRef.current = false;
                }
              }, 400);
            }
          },
        });
        if (!cancelled) {
          setEarsOn(true);
          setPhase("sleep");
          setMicMsg("همیشه شنوا — بگو «هی میشل» یا Hey Micheal");
        }
      } catch (err) {
        if (!cancelled) {
          setEarsOn(false);
          setMicMsg(
            err instanceof Error
              ? err.message
              : "میکروفون بسته است. Settings → Privacy → Microphone را برای Micheal روشن کن.",
          );
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      voice.stopJarvisEars();
      setEarsOn(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once per connection
  }, [cloud, connected, voice, wake]);

  const boardReady = Boolean(session?.symbol && session?.timeframe);
  const orbClass = [
    "orb",
    state.speaking || phase === "speaking" ? "speaking" : "",
    earsOn && phase !== "sleep" ? "listening" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const caption =
    phase === "speaking" || state.speaking
      ? "در حال صحبت…"
      : phase === "thinking"
        ? "دارم می‌فهمم…"
        : phase === "listening" || wake.isConversationOpen
          ? "بیدارم — حرف بزن"
          : earsOn
            ? "خواب سبک — بگو هی میشل"
            : "در انتظار میکروفون…";

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !cloud) return;
    setDraft("");
    wake.keepAlive();
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
          <div className="brand-sub">هی میشل · همیشه شنوا · فارسی / English</div>
        </div>
        <div className="pills">
          <span className="pill">
            <span className={`dot ${state.live ? "on" : ""}`} />
            {state.live ? "زنده" : "وصل…"}
          </span>
          <span className="pill">
            <span className={`dot ${earsOn ? (wake.isConversationOpen ? "warn" : "on") : ""}`} />
            {!earsOn ? "میک قطع" : wake.isConversationOpen ? "بیدار" : "منتظر wake"}
          </span>
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
                  ? `با هم روی ${session!.symbol} · ${session!.timeframe}. مثل جارویس — بدون دکمه.`
                  : "هیچ پیش‌فرضی نیست. بگو «هی میشل، طلا پانزده»."}
            </p>
            <div className="level" aria-hidden>
              <div className="level-fill" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            {micMsg ? <p className="hint danger">{micMsg}</p> : null}
            <p className="hint">
              Wake: «هی میشل» / Hey Micheal — بعدش ۷۵ ثانیه بدون wake حرف بزن. نوار سبز = گوش فعال.
            </p>
          </div>
        </section>

        <aside className="side">
          <section className="panel">
            <h3>فید جلسه</h3>
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
                {state.voiceEnabled ? "پاسخ صوتی روشن" : "پاسخ صوتی خاموش"}
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
                placeholder="اختیاری — معمولاً فقط حرف بزن"
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
