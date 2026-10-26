import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { SessionState } from "@micheal/protocol";
import { MichealCloud } from "@/cloud";
import { loadConfig } from "@/config";
import { createVoice } from "@/voice";
import { WakeGate } from "@/wake";
import { captureForMicheal, wantsVision } from "@/vision";
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
                setMicMsg(`شنیدم ولی بیدار نیستم — بگو «هی مایکل» / Hey Micheal`);
                setPhase("sleep");
                return;
              }
              if (gate.wokeNow && !gate.command) {
                setMicMsg(null);
                cloud.chat(hasPersian(text) ? "سلام مایکل" : "Hey Micheal");
                return;
              }
              setMicMsg(null);
              setPhase("thinking");
              const cmd = gate.command || text;
              let image: string | undefined;
              if (wantsVision(cmd)) {
                setMicMsg("دارم چارت/صفحه را می‌بینم…");
                image = (await captureForMicheal()) ?? undefined;
                setMicMsg(image ? null : "اسکرین گرفته نشد — Screen permission را چک کن.");
              }
              cloud.chat(cmd, image);
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
          setMicMsg("همیشه شنوا — بگو «هی مایکل» یا Hey Micheal");
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
    "core-orb",
    state.speaking || phase === "speaking" ? "speaking" : "",
    earsOn && phase !== "sleep" ? "listening" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const caption =
    phase === "speaking" || state.speaking
      ? "در حال پاسخ…"
      : phase === "thinking"
        ? "در حال استدلال…"
        : phase === "listening" || wake.isConversationOpen
          ? "آگاه و شنوا"
          : earsOn
            ? "آماده — بگو هی مایکل"
            : "در انتظار حسگر صوتی…";

  const cognition =
    phase === "speaking" || state.speaking
      ? "SPEAK"
      : phase === "thinking"
        ? "REASON"
        : wake.isConversationOpen
          ? "ACTIVE"
          : earsOn
            ? "STANDBY"
            : "OFFLINE";

  const sendWithOptionalVision = async (text: string) => {
    if (!cloud) return;
    wake.keepAlive();
    let image: string | undefined;
    if (wantsVision(text)) {
      setPhase("thinking");
      setMicMsg("دارم صفحه‌ات / TradingView را می‌بینم…");
      try {
        image = (await captureForMicheal()) ?? undefined;
        if (!image) {
          setMicMsg("نتونستم صفحه را بگیرم — در ویندوز به Micheal اجازه Screen بده، یا TradingView را جلو بیاور.");
        } else {
          setMicMsg(null);
        }
      } catch {
        setMicMsg("دسترسی به صفحه رد شد.");
      }
    }
    cloud.chat(text, image);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !cloud) return;
    setDraft("");
    void sendWithOptionalVision(text);
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
        <div className="gate-inner">
          <h1 className="brand-hero">MICHEAL</h1>
          <p>initializing cognition</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app" dir="rtl">
      <section className="presence" aria-label="Micheal">
        <div className="presence-bg" aria-hidden />
        <div className="presence-inner">
          <h1 className="brand-hero">MICHEAL</h1>
          <p className="brand-tag">Cognitive trading companion</p>

          <div className="core" aria-hidden>
            <div className="core-ring" />
            <div className="core-ring mid" />
            <div className="core-ring inner" />
            <div className={orbClass} />
          </div>

          <p className="status-line">{caption}</p>
          <p className="status-sub">
            {heard
              ? `شنیدم: ${heard}`
              : boardReady
                ? `چارچوب فعال — ${session!.symbol} · ${session!.timeframe}. بدون دکمه حرف بزن.`
                : "محمد، مایکل آماده‌ست. بگو «هی مایکل»، بعد نماد و تایم‌فریم را با هم قفل می‌کنیم."}
          </p>

          <div className="audio-rail" aria-hidden>
            <i style={{ width: `${Math.round(level * 100)}%` }} />
          </div>

          <div className="telemetry">
            <span className={state.live ? "live" : ""}>
              link <b>{state.live ? "GERMANY" : "…"}</b>
            </span>
            <span>
              mind <b>{cognition}</b>
            </span>
            <span>
              wake <b>{wake.isConversationOpen ? "OPEN" : "ARMED"}</b>
            </span>
            <span>
              board <b>{boardReady ? `${session!.symbol}/${session!.timeframe}` : "—"}</b>
            </span>
          </div>

          {micMsg ? <p className="alert">{micMsg}</p> : null}
        </div>
      </section>

      <div className="workspace">
        <section className="stream">
          <div className="stream-head">
            <h2>Thought stream</h2>
            <span>FA / EN · voice-first</span>
          </div>
          <div className={`scroll ${rtlChat ? "rtl-text" : ""}`} ref={scrollRef}>
            {state.messages.length === 0 ? (
              <div className="turn system">هنوز گفت‌وگویی نیست — با «هی مایکل» شروع کن.</div>
            ) : (
              state.messages.map((m) => (
                <div key={m.id} className={`turn ${m.role}`} dir={hasPersian(m.text) ? "rtl" : "ltr"}>
                  <span className="who">
                    {m.role === "micheal" ? "Micheal" : m.role === "you" ? "You" : "System"}
                    {m.spoken ? " · voiced" : ""}
                  </span>
                  {m.text}
                </div>
              ))
            )}
          </div>
          <form className="composer" onSubmit={onSubmit}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="اختیاری — معمولاً فقط حرف بزن"
              aria-label="Message"
              dir="rtl"
            />
            <button type="submit">ارسال</button>
          </form>
        </section>

        <aside className="session">
          <h2>Session frame</h2>
          <div className="grid2">
            <div className="field">
              <label htmlFor="symbol">نماد</label>
              <input
                id="symbol"
                value={session?.symbol ?? ""}
                placeholder="—"
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
                <option value="">—</option>
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="price">مارک</label>
              <input
                id="price"
                value={priceDraft}
                placeholder="price"
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
                <option value="unknown">—</option>
                <option value="long">long</option>
                <option value="short">short</option>
                <option value="flat">flat</option>
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
          <div className="ctrl">
            <button
              type="button"
              className={session?.focusMode ? "on" : ""}
              onClick={() => cloud?.patchSession({ focusMode: !session?.focusMode })}
            >
              Focus
            </button>
            <button
              type="button"
              className={state.voiceEnabled ? "on" : ""}
              onClick={() => {
                const next = !state.voiceEnabled;
                voice.setEnabled(next);
                cloud?.setVoiceEnabled(next);
              }}
            >
              Voice {state.voiceEnabled ? "on" : "off"}
            </button>
            <button
              type="button"
              onClick={() => {
                void sendWithOptionalVision(
                  "Look at my TradingView / screen now and tell me exactly what you see on the chart.",
                );
              }}
            >
              Look
            </button>
          </div>
          <p className="hint">
            محمد × مایکل · هی مایکل · ببین چارت / Look · GPT · Germany
          </p>
        </aside>
      </div>
    </div>
  );
}
