const PERSIAN_RE = /[\u0600-\u06FF]/;

export interface Voice {
  readonly supported: { readonly tts: boolean; readonly stt: boolean };
  speak(text: string): Promise<void>;
  stop(): void;
  listen(lang?: "en" | "fa"): Promise<string>;
  startAmbient(opts: {
    lang?: "en" | "fa";
    onPartial?: (text: string) => void;
    onPhrase: (text: string) => void;
    onListening?: (on: boolean) => void;
  }): void;
  stopAmbient(): void;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  setListenLang(lang: "en" | "fa"): void;
  /** Soft-pause ears during Micheal speech (no hear/see flicker). */
  setPaused(paused: boolean): void;
}

export function createVoice(): Voice {
  const tts = typeof window !== "undefined" && "speechSynthesis" in window;
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const stt = Boolean(Recognition);
  let enabled = true;
  let listenLang: "en" | "fa" = "fa";
  let recognition: SpeechRecognition | null = null;
  let ambient = false;
  let paused = false;
  let speaking = false;
  let ambientOpts: Parameters<Voice["startAmbient"]>[0] | null = null;
  let restartTimer: number | null = null;
  let earsReported = false;
  let lastPhraseAt = 0;
  let lastPhrase = "";

  const pickVoice = (text: string): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    // Prefer Persian voices whenever possible (Micheal speaks FA)
    return (
      voices.find((v) => /fa/i.test(v.lang)) ??
      voices.find((v) => /persian|farsi/i.test(v.name)) ??
      (PERSIAN_RE.test(text)
        ? voices.find((v) => /en-/i.test(v.lang))
        : voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|google uk/i.test(v.name))) ??
      voices.find((v) => /en-/i.test(v.lang)) ??
      voices[0] ??
      null
    );
  };

  const clearRestart = () => {
    if (restartTimer != null) {
      window.clearTimeout(restartTimer);
      restartTimer = null;
    }
  };

  const reportEars = (on: boolean) => {
    if (earsReported === on) return;
    earsReported = on;
    ambientOpts?.onListening?.(on);
  };

  const shouldAcceptPhrase = (text: string): boolean => {
    const t = text.trim();
    if (t.length < 2) return false;
    if (speaking || paused) return false;
    const now = Date.now();
    // Drop echo / duplicates right after Micheal spoke or same phrase
    if (now - lastPhraseAt < 900 && t === lastPhrase) return false;
    if (now - lastPhraseAt < 450) return false;
    lastPhraseAt = now;
    lastPhrase = t;
    return true;
  };

  const scheduleRestart = (ms: number) => {
    clearRestart();
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      runAmbient();
    }, ms);
  };

  const stopRec = (hard = false) => {
    clearRestart();
    const rec = recognition;
    recognition = null;
    if (!rec) return;
    try {
      if (hard) rec.abort();
      else rec.stop();
    } catch {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
  };

  const runAmbient = () => {
    if (!ambient || !enabled || !Recognition || !ambientOpts) return;
    if (paused || speaking) {
      reportEars(true); // still "armed" — no flicker to "seeing"
      scheduleRestart(400);
      return;
    }

    stopRec(true);

    const use = ambientOpts.lang ?? listenLang;
    const rec = new Recognition();
    recognition = rec;
    // Windows/Electron: single-utterance loop is far more stable than continuous=true
    rec.lang = use === "fa" ? "fa-IR" : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    reportEars(true);

    rec.onresult = (event) => {
      if (speaking || paused) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const row = event.results[i];
        const text = row?.[0]?.transcript?.trim() ?? "";
        if (!text) continue;
        if (row.isFinal) {
          if (shouldAcceptPhrase(text)) ambientOpts?.onPhrase(text);
        } else {
          interim = text;
        }
      }
      if (interim && !speaking && !paused) ambientOpts?.onPartial?.(interim);
    };

    rec.onerror = (event) => {
      recognition = null;
      // "aborted" / "no-speech" are normal — keep ears armed, quiet restart
      const err = event.error || "";
      if (!ambient) {
        reportEars(false);
        return;
      }
      reportEars(true);
      scheduleRestart(err === "not-allowed" ? 3000 : 500);
    };

    rec.onend = () => {
      recognition = null;
      if (!ambient) {
        reportEars(false);
        return;
      }
      reportEars(true);
      scheduleRestart(paused || speaking ? 500 : 280);
    };

    try {
      rec.start();
    } catch {
      scheduleRestart(700);
    }
  };

  return {
    supported: { tts, stt },
    setEnabled(on) {
      enabled = on;
      if (!on) this.stop();
    },
    isEnabled: () => enabled,
    setListenLang(lang) {
      listenLang = lang;
      if (ambientOpts) ambientOpts = { ...ambientOpts, lang };
    },
    setPaused(next) {
      paused = next;
      if (next) {
        stopRec(true);
        reportEars(true);
      } else if (ambient) {
        scheduleRestart(200);
      }
    },
    speak(text) {
      if (!enabled || !tts || !text.trim()) return Promise.resolve();
      speaking = true;
      paused = true;
      stopRec(true);
      reportEars(true);
      window.speechSynthesis.cancel();
      return new Promise((resolve) => {
        const utter = new SpeechSynthesisUtterance(text);
        const v = pickVoice(text);
        if (v) utter.voice = v;
        // Always prefer Persian speech settings for Micheal
        utter.lang = PERSIAN_RE.test(text) || listenLang === "fa" ? "fa-IR" : v?.lang || "en-GB";
        utter.rate = 0.98;
        utter.pitch = 0.92;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          speaking = false;
          // Hold pause briefly so STT doesn't echo Micheal's voice
          window.setTimeout(() => {
            paused = false;
            if (ambient) scheduleRestart(150);
            resolve();
          }, 550);
        };
        utter.onend = done;
        utter.onerror = done;
        window.speechSynthesis.speak(utter);
      });
    },
    stop() {
      if (tts) window.speechSynthesis.cancel();
      speaking = false;
      paused = false;
      this.stopAmbient();
      stopRec(true);
    },
    startAmbient(opts) {
      if (!Recognition) return;
      ambientOpts = opts;
      ambient = true;
      earsReported = false;
      clearRestart();
      runAmbient();
    },
    stopAmbient() {
      ambient = false;
      clearRestart();
      stopRec(true);
      if (earsReported) {
        earsReported = false;
        ambientOpts?.onListening?.(false);
      }
    },
    listen(lang) {
      if (!enabled || !Recognition) {
        return Promise.reject(new Error("Mic needs Chrome/Edge on the PC."));
      }
      const wasAmbient = ambient;
      const saved = ambientOpts;
      this.stopAmbient();
      const use = lang ?? listenLang;
      return new Promise((resolve, reject) => {
        const rec = new Recognition();
        recognition = rec;
        rec.lang = use === "fa" ? "fa-IR" : "en-US";
        rec.interimResults = false;
        rec.continuous = false;
        rec.onresult = (event) => {
          const transcript = event.results[0]?.[0]?.transcript?.trim() ?? "";
          recognition = null;
          if (wasAmbient && saved) this.startAmbient(saved);
          if (transcript) resolve(transcript);
          else reject(new Error("نشنیدم."));
        };
        rec.onerror = (event) => {
          recognition = null;
          if (wasAmbient && saved) this.startAmbient(saved);
          reject(new Error(event.error || "Mic error"));
        };
        rec.onend = () => {
          recognition = null;
        };
        try {
          rec.start();
        } catch (err) {
          recognition = null;
          if (wasAmbient && saved) this.startAmbient(saved);
          reject(err instanceof Error ? err : new Error("Mic failed"));
        }
      });
    },
  };
}
