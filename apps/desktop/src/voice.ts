export interface Voice {
  readonly supported: { readonly tts: boolean; readonly stt: boolean };
  speak(text: string): Promise<void>;
  stop(): void;
  listen(): Promise<string>;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
}

export function createVoice(): Voice {
  const tts = typeof window !== "undefined" && "speechSynthesis" in window;
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const stt = Boolean(Recognition);
  let enabled = true;
  let recognition: SpeechRecognition | null = null;

  const pickVoice = (): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|google uk/i.test(v.name)) ??
      voices.find((v) => /en-GB/i.test(v.lang)) ??
      voices.find((v) => /en-/i.test(v.lang)) ??
      voices[0] ??
      null
    );
  };

  return {
    supported: { tts, stt },
    setEnabled(on) {
      enabled = on;
      if (!on) this.stop();
    },
    isEnabled: () => enabled,
    speak(text) {
      if (!enabled || !tts || !text.trim()) return Promise.resolve();
      window.speechSynthesis.cancel();
      return new Promise((resolve) => {
        const utter = new SpeechSynthesisUtterance(text);
        const voice = pickVoice();
        if (voice) utter.voice = voice;
        utter.rate = 0.98;
        utter.pitch = 0.92;
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
      });
    },
    stop() {
      if (tts) window.speechSynthesis.cancel();
      try {
        recognition?.abort();
      } catch {
        /* ignore */
      }
      recognition = null;
    },
    listen() {
      if (!enabled || !Recognition) {
        return Promise.reject(new Error("Mic needs Chrome/Edge on the PC."));
      }
      this.stop();
      return new Promise((resolve, reject) => {
        const rec = new Recognition();
        recognition = rec;
        rec.lang = "en-US";
        rec.interimResults = false;
        rec.continuous = false;
        rec.onresult = (event) => {
          const transcript = event.results[0]?.[0]?.transcript?.trim() ?? "";
          recognition = null;
          if (transcript) resolve(transcript);
          else reject(new Error("Didn't catch that."));
        };
        rec.onerror = (event) => {
          recognition = null;
          reject(new Error(event.error || "Mic error"));
        };
        rec.onend = () => {
          recognition = null;
        };
        try {
          rec.start();
        } catch (err) {
          recognition = null;
          reject(err instanceof Error ? err : new Error("Mic failed"));
        }
      });
    },
  };
}
