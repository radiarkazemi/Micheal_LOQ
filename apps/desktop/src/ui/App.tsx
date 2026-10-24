import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { SessionState } from "@micheal/protocol";
import { MichealCloud } from "@/cloud";
import { createVoice } from "@/voice";
import "./styles.css";

const TIMEFRAMES = ["1", "5", "15", "60", "240", "D"] as const;

function readConfig() {
  const url =
    import.meta.env.VITE_MICHEAL_URL ||
    import.meta.env.VITE_VIGIL_URL ||
    "http://127.0.0.1:8787";
  const token =
    import.meta.env.VITE_MICHEAL_TOKEN ||
    import.meta.env.VITE_VIGIL_TOKEN ||
    "dev-token-change-me";
  return { url, token };
}

export function App() {
  const voice = useMemo(() => createVoice(), []);
  const cloud = useMemo(() => {
    const { url, token } = readConfig();
    return new MichealCloud(url, token, (text) => voice.speak(text));
  }, [voice]);

  const state = useSyncExternalStore(
    (cb) => cloud.subscribe(cb),
    () => cloud.getState(),
    () => cloud.getState(),
  );

  const [draft, setDraft] = useState("");
  const [priceDraft, setPriceDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const session = state.session;

  useEffect(() => {
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
    ? "Listening…"
    : state.speaking
      ? "Speaking…"
      : !state.connected
        ? "Linking to cloud brain…"
        : session?.focusMode
          ? "Focus lock engaged"
          : "Standing by";

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    cloud.chat(text);
  };

  const applyPrice = () => {
    const raw = priceDraft.trim();
    if (!raw) {
      cloud.patchSession({ price: null });
      return;
    }
    const n = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(n)) cloud.patchSession({ price: n });
  };

  const pushToTalk = async () => {
    if (!voice.supported.stt) return;
    cloud.setListening(true);
    try {
      const text = await voice.listen();
      cloud.setListening(false);
      cloud.chat(text);
    } catch {
      cloud.setListening(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand-mark">MICHEAL</div>
          <div className="brand-sub">TRADING ASSISTANT · DESKTOP PRESENCE · DE CLOUD BRAIN</div>
        </div>
        <div className="pills">
          <span className="pill">
            <span className={`dot ${state.connected ? "on" : ""}`} />
            {state.connected ? "cloud linked" : "cloud offline"}
          </span>
          <span className="pill">
            <span className={`dot ${state.status === "speaking" || state.status === "listening" ? "warn" : ""}`} />
            {state.status}
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
              {session
                ? `Watching ${session.symbol} · ${session.timeframe}${session.price != null ? ` · ${session.price}` : ""}. Voice on the PC — judgment on the Germany server.`
                : "Connecting to your private cloud brain…"}
            </p>
          </div>
        </section>

        <aside className="side">
          <section className="panel">
            <h3>Session feed</h3>
            <div className="grid2">
              <div className="field">
                <label htmlFor="symbol">Symbol</label>
                <input
                  id="symbol"
                  value={session?.symbol ?? ""}
                  onChange={(e) => cloud.patchSession({ symbol: e.target.value })}
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label htmlFor="tf">Timeframe</label>
                <select
                  id="tf"
                  value={session?.timeframe ?? "15"}
                  onChange={(e) => cloud.patchSession({ timeframe: e.target.value })}
                >
                  {TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="price">Price mark</label>
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
                <label htmlFor="bias">Bias</label>
                <select
                  id="bias"
                  value={session?.bias ?? "unknown"}
                  onChange={(e) => cloud.patchSession({ bias: e.target.value as SessionState["bias"] })}
                >
                  <option value="unknown">unknown</option>
                  <option value="long">long</option>
                  <option value="short">short</option>
                  <option value="flat">flat</option>
                </select>
              </div>
              <div className="field span2">
                <label htmlFor="note">Plan / invalidation</label>
                <textarea
                  id="note"
                  value={session?.note ?? ""}
                  placeholder="Invalid below swing low…"
                  onChange={(e) => cloud.patchSession({ note: e.target.value })}
                />
              </div>
            </div>
            <div className="chips">
              <button
                type="button"
                className={`chip ${session?.focusMode ? "on" : ""}`}
                onClick={() => cloud.patchSession({ focusMode: !session?.focusMode })}
              >
                Focus mode
              </button>
              <button
                type="button"
                className={`chip ${state.voiceEnabled ? "on" : ""}`}
                onClick={() => {
                  const next = !state.voiceEnabled;
                  voice.setEnabled(next);
                  cloud.setVoiceEnabled(next);
                }}
              >
                Voice {state.voiceEnabled ? "on" : "off"}
              </button>
            </div>
          </section>

          <section className="panel transcript">
            <h3>Channel</h3>
            <div className="scroll" ref={scrollRef}>
              {state.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.role}`}>
                  <span className="meta">
                    {m.role === "micheal" ? "MICHEAL" : m.role === "you" ? "YOU" : "SYS"}
                    {m.spoken ? " · voiced" : ""}
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
                placeholder="Talk to Micheal…"
                aria-label="Message"
              />
              <button
                type="button"
                className={`btn ghost mic ${state.listening ? "on" : ""}`}
                onClick={() => void pushToTalk()}
                disabled={!voice.supported.stt}
              >
                Mic
              </button>
              <button type="submit" className="btn">
                Send
              </button>
            </form>
            <p className="hint">PC: voice + HUD · Cloud (DE): brain + memory · Chrome/Edge for mic</p>
          </section>
        </aside>
      </main>
    </div>
  );
}
