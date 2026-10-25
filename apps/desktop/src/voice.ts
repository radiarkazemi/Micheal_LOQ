const PERSIAN_RE = /[\u0600-\u06FF]/;

export interface Voice {
  readonly supported: { readonly tts: boolean; readonly stt: boolean; readonly media: boolean };
  speak(text: string): Promise<void>;
  stop(): void;
  /** Toggle recorder: call start, then stop → audio blob for cloud STT. */
  startRecording(onLevel?: (level: number) => void): Promise<void>;
  stopRecording(): Promise<Blob>;
  isRecording(): boolean;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  setListenLang(lang: "en" | "fa"): void;
  setPaused(paused: boolean): void;
  /** Legacy Web Speech — usually broken in Electron; kept unused. */
  listen(lang?: "en" | "fa"): Promise<string>;
  startAmbient(_opts: unknown): void;
  stopAmbient(): void;
}

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}

export function createVoice(): Voice {
  const tts = typeof window !== "undefined" && "speechSynthesis" in window;
  const media = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  let enabled = true;
  let listenLang: "en" | "fa" = "fa";

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let recording = false;
  let levelTimer: number | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;

  const pickVoice = (text: string): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((v) => /fa/i.test(v.lang)) ??
      voices.find((v) => /persian|farsi/i.test(v.name)) ??
      (PERSIAN_RE.test(text) ? voices.find((v) => /en-/i.test(v.lang)) : null) ??
      voices.find((v) => /en-/i.test(v.lang)) ??
      voices[0] ??
      null
    );
  };

  const clearLevel = () => {
    if (levelTimer != null) {
      window.clearInterval(levelTimer);
      levelTimer = null;
    }
  };

  const ensureStream = async (): Promise<MediaStream> => {
    if (stream && stream.getTracks().some((t) => t.readyState === "live")) return stream;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    return stream;
  };

  return {
    supported: { tts, stt: Boolean(Recognition) || media, media },
    setEnabled(on) {
      enabled = on;
      if (!on) this.stop();
    },
    isEnabled: () => enabled,
    setListenLang(lang) {
      listenLang = lang;
    },
    setPaused(_next) {
      /* reserved — MediaRecorder path does not need pause */
    },
    isRecording: () => recording,
    startAmbient() {
      /* Web Speech ambient is unreliable in Electron — push-to-talk only */
    },
    stopAmbient() {
      /* no-op */
    },
    async startRecording(onLevel) {
      if (!enabled) throw new Error("صدا خاموش است.");
      if (recording) return;
      const s = await ensureStream();
      chunks = [];
      const mime = pickMime();
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      recorder = rec;
      recording = true;

      try {
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(s);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        clearLevel();
        levelTimer = window.setInterval(() => {
          if (!analyser) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i]! - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          onLevel?.(Math.min(1, rms * 4));
        }, 80);
      } catch {
        /* level meter optional */
      }

      await new Promise<void>((resolve, reject) => {
        rec.onerror = () => reject(new Error("ضبط صدا."));
        rec.onstart = () => resolve();
        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };
        try {
          rec.start(250);
        } catch (err) {
          recording = false;
          reject(err instanceof Error ? err : new Error("شروع ضبط نشد"));
        }
      });
    },
    async stopRecording() {
      if (!recorder || !recording) {
        return new Blob();
      }
      const rec = recorder;
      clearLevel();
      if (audioCtx) {
        void audioCtx.close().catch(() => undefined);
        audioCtx = null;
        analyser = null;
      }
      const blob = await new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          const type = rec.mimeType || "audio/webm";
          resolve(new Blob(chunks, { type }));
        };
        try {
          rec.stop();
        } catch {
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        }
      });
      recording = false;
      recorder = null;
      chunks = [];
      return blob;
    },
    speak(text) {
      if (!enabled || !tts || !text.trim()) return Promise.resolve();
      window.speechSynthesis.cancel();
      return new Promise((resolve) => {
        const utter = new SpeechSynthesisUtterance(text);
        const v = pickVoice(text);
        if (v) utter.voice = v;
        utter.lang = PERSIAN_RE.test(text) || listenLang === "fa" ? "fa-IR" : v?.lang || "en-GB";
        utter.rate = 0.98;
        utter.pitch = 0.92;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          window.setTimeout(() => resolve(), 350);
        };
        utter.onend = done;
        utter.onerror = done;
        window.speechSynthesis.speak(utter);
      });
    },
    stop() {
      if (tts) window.speechSynthesis.cancel();
      if (recording) void this.stopRecording();
      if (stream) {
        for (const t of stream.getTracks()) t.stop();
        stream = null;
      }
    },
    listen() {
      return Promise.reject(
        new Error("در اپ ویندوز از دکمه میکروفون استفاده کن (ضبط واقعی)."),
      );
    },
  };
}
