const PERSIAN_RE = /[\u0600-\u06FF]/;

export interface Voice {
  readonly supported: { readonly tts: boolean; readonly stt: boolean };
  speak(text: string): Promise<void>;
  stop(): void;
  listen(lang?: "en" | "fa"): Promise<string>;
  /** Continuous Jarvis ears — keeps listening and streams final phrases. */
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
}

export function createVoice(): Voice {
  const tts = typeof window !== "undefined" && "speechSynthesis" in window;
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const stt = Boolean(Recognition);
  let enabled = true;
  let listenLang: "en" | "fa" = "fa";
  let recognition: SpeechRecognition | null = null;
  let ambient = false;
  let ambientOpts: Parameters<Voice["startAmbient"]>[0] | null = null;
  let restartTimer: number | null = null;

  const pickVoice = (text: string): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    const wantFa = PERSIAN_RE.test(text);
    if (wantFa) {
      return (
        voices.find((v) => /fa/i.test(v.lang)) ??
        voices.find((v) => /persian|farsi/i.test(v.name)) ??
        voices.find((v) => /en-/i.test(v.lang)) ??
        voices[0] ??
        null
      );
    }
    return (
      voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|google uk/i.test(v.name)) ??
      voices.find((v) => /en-GB/i.test(v.lang)) ??
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

  const runAmbient = () => {
    if (!ambient || !enabled || !Recognition || !ambientOpts) return;
    try {
      recognition?.abort();
    } catch {
      /* ignore */
    }
    const use = ambientOpts.lang ?? listenLang;
    const rec = new Recognition();
    recognition = rec;
    rec.lang = use === "fa" ? "fa-IR" : "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    ambientOpts.onListening?.(true);

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const row = event.results[i];
        const text = row?.[0]?.transcript?.trim() ?? "";
        if (!text) continue;
        if (row.isFinal) {
          ambientOpts?.onPhrase(text);
        } else {
          interim = text;
        }
      }
      if (interim) ambientOpts?.onPartial?.(interim);
    };

    rec.onerror = () => {
      ambientOpts?.onListening?.(false);
      if (!ambient) return;
      clearRestart();
      restartTimer = window.setTimeout(runAmbient, 600);
    };

    rec.onend = () => {
      ambientOpts?.onListening?.(false);
      recognition = null;
      if (!ambient) return;
      clearRestart();
      restartTimer = window.setTimeout(runAmbient, 250);
    };

    try {
      rec.start();
    } catch {
      clearRestart();
      restartTimer = window.setTimeout(runAmbient, 800);
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
      if (ambient && ambientOpts) {
        ambientOpts = { ...ambientOpts, lang };
        this.stopAmbient();
        this.startAmbient(ambientOpts);
      }
    },
    speak(text) {
      if (!enabled || !tts || !text.trim()) return Promise.resolve();
      // Pause ambient briefly so Micheal doesn't hear himself
      const wasAmbient = ambient;
      if (wasAmbient) this.stopAmbient();
      window.speechSynthesis.cancel();
      return new Promise((resolve) => {
        const utter = new SpeechSynthesisUtterance(text);
        const voice = pickVoice(text);
        if (voice) utter.voice = voice;
        utter.lang = PERSIAN_RE.test(text) ? "fa-IR" : voice?.lang || "en-GB";
        utter.rate = 0.98;
        utter.pitch = 0.92;
        const done = () => {
          if (wasAmbient && ambientOpts) this.startAmbient(ambientOpts);
          resolve();
        };
        utter.onend = done;
        utter.onerror = done;
        window.speechSynthesis.speak(utter);
      });
    },
    stop() {
      if (tts) window.speechSynthesis.cancel();
      this.stopAmbient();
      try {
        recognition?.abort();
      } catch {
        /* ignore */
      }
      recognition = null;
    },
    startAmbient(opts) {
      if (!Recognition) return;
      ambientOpts = opts;
      ambient = true;
      clearRestart();
      runAmbient();
    },
    stopAmbient() {
      ambient = false;
      clearRestart();
      try {
        recognition?.abort();
      } catch {
        /* ignore */
      }
      recognition = null;
      ambientOpts?.onListening?.(false);
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
          else reject(new Error(use === "fa" ? "نشنیدم." : "Didn't catch that."));
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
