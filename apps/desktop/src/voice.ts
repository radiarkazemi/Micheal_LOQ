const PERSIAN_RE = /[\u0600-\u06FF]/;

export interface JarvisEarsOpts {
  onLevel?: (level: number) => void;
  /** Fired when a full utterance is cut by VAD (speech then silence). */
  onUtterance: (blob: Blob) => void | Promise<void>;
  /** Return false while Micheal is speaking / busy. */
  shouldListen?: () => boolean;
}

export interface Voice {
  readonly supported: { readonly tts: boolean; readonly stt: boolean; readonly media: boolean };
  speak(text: string, opts?: { lang?: "fa" | "en"; cloudSpeak?: (t: string, lang: "fa" | "en") => Promise<HTMLAudioElement | null> }): Promise<void>;
  stop(): void;
  startJarvisEars(opts: JarvisEarsOpts): Promise<void>;
  stopJarvisEars(): void;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  setListenLang(lang: "en" | "fa"): void;
  setPaused(paused: boolean): void;
  isPaused(): boolean;
  /** Manual fallback */
  startRecording(onLevel?: (level: number) => void): Promise<void>;
  stopRecording(): Promise<Blob>;
  isRecording(): boolean;
  listen(lang?: "en" | "fa"): Promise<string>;
  startAmbient(_opts: unknown): void;
  stopAmbient(): void;
}

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}

export function createVoice(): Voice {
  const tts = typeof window !== "undefined" && "speechSynthesis" in window;
  const media = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  let enabled = true;
  let listenLang: "en" | "fa" = "fa";
  let paused = false;

  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let jarvisOn = false;
  let jarvisOpts: JarvisEarsOpts | null = null;
  let tickTimer: number | null = null;
  let rec: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let inSpeech = false;
  let speechMs = 0;
  let silenceMs = 0;
  let lastEmitAt = 0;
  let processing = false;
  let manualRecording = false;
  let levelTimer: number | null = null;
  let currentAudio: HTMLAudioElement | null = null;

  const SPEECH_ON = 0.035;
  const SPEECH_OFF = 0.02;
  const MIN_SPEECH_MS = 450;
  const END_SILENCE_MS = 900;
  const MAX_UTTER_MS = 12_000;
  const TICK_MS = 100;

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

  const ensureStream = async (): Promise<MediaStream> => {
    if (stream && stream.getTracks().some((t) => t.readyState === "live")) return stream;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    return stream;
  };

  const rmsFromAnalyser = (): number => {
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  };

  const resetUtteranceBuffer = () => {
    chunks = [];
    inSpeech = false;
    speechMs = 0;
    silenceMs = 0;
  };

  const emitUtterance = async () => {
    if (processing || !jarvisOpts) return;
    if (speechMs < MIN_SPEECH_MS || chunks.length === 0) {
      resetUtteranceBuffer();
      return;
    }
    if (Date.now() - lastEmitAt < 700) {
      resetUtteranceBuffer();
      return;
    }
    const type = rec?.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type });
    resetUtteranceBuffer();
    if (blob.size < 1200) return;
    processing = true;
    lastEmitAt = Date.now();
    paused = true; // don't capture while we think / answer
    try {
      await jarvisOpts.onUtterance(blob);
    } finally {
      processing = false;
      // stay paused until speak() finishes; App will clear via setPaused(false)
    }
  };

  const stopTick = () => {
    if (tickTimer != null) {
      window.clearInterval(tickTimer);
      tickTimer = null;
    }
  };

  const localSpeak = (text: string): Promise<void> =>
    new Promise((resolve) => {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const v = pickVoice(text);
      if (v) utter.voice = v;
      utter.lang = PERSIAN_RE.test(text) || listenLang === "fa" ? "fa-IR" : v?.lang || "en-GB";
      utter.rate = 0.98;
      utter.pitch = 0.92;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      utter.onend = finish;
      utter.onerror = finish;
      window.speechSynthesis.speak(utter);
      // safety
      window.setTimeout(finish, Math.min(30_000, 800 + text.length * 80));
    });

  return {
    supported: { tts, stt: media, media },
    setEnabled(on) {
      enabled = on;
      if (!on) this.stop();
    },
    isEnabled: () => enabled,
    setListenLang(lang) {
      listenLang = lang;
    },
    setPaused(next) {
      paused = next;
      if (next) resetUtteranceBuffer();
    },
    isPaused: () => paused,
    isRecording: () => manualRecording || inSpeech,
    startAmbient() {},
    stopAmbient() {},

    async startJarvisEars(opts) {
      if (!enabled || !media) throw new Error("میکروفون در دسترس نیست");
      jarvisOpts = opts;
      jarvisOn = true;
      const s = await ensureStream();
      if (!audioCtx) {
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(s);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
      }
      if (audioCtx.state === "suspended") await audioCtx.resume();

      if (!rec || rec.state === "inactive") {
        const mime = pickMime();
        rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
        rec.ondataavailable = (ev) => {
          if (!jarvisOn || paused || processing) return;
          if (opts.shouldListen && !opts.shouldListen()) return;
          if (ev.data.size > 0 && (inSpeech || chunks.length > 0)) chunks.push(ev.data);
        };
        rec.start(TICK_MS);
      }

      stopTick();
      tickTimer = window.setInterval(() => {
        if (!jarvisOn || !enabled) return;
        const level = Math.min(1, rmsFromAnalyser() * 4);
        opts.onLevel?.(level);

        if (paused || processing || (opts.shouldListen && !opts.shouldListen())) {
          if (inSpeech) resetUtteranceBuffer();
          return;
        }

        const speakingNow = level > (inSpeech ? SPEECH_OFF : SPEECH_ON);
        if (speakingNow) {
          if (!inSpeech) {
            inSpeech = true;
            speechMs = 0;
            silenceMs = 0;
            chunks = [];
          }
          speechMs += TICK_MS;
          silenceMs = 0;
          if (speechMs >= MAX_UTTER_MS) void emitUtterance();
        } else if (inSpeech) {
          silenceMs += TICK_MS;
          if (silenceMs >= END_SILENCE_MS) void emitUtterance();
        }
      }, TICK_MS);
    },

    stopJarvisEars() {
      jarvisOn = false;
      jarvisOpts = null;
      stopTick();
      resetUtteranceBuffer();
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      rec = null;
    },

    async startRecording(onLevel) {
      manualRecording = true;
      await this.startJarvisEars({
        onLevel,
        onUtterance: () => undefined,
      });
      // Force collect everything until stopRecording
      inSpeech = true;
      paused = false;
    },

    async stopRecording() {
      manualRecording = false;
      const type = rec?.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      resetUtteranceBuffer();
      return blob;
    },

    async speak(text, opts) {
      if (!enabled || !text.trim()) return;
      paused = true;
      resetUtteranceBuffer();
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      window.speechSynthesis.cancel();

      const lang: "fa" | "en" = opts?.lang ?? (PERSIAN_RE.test(text) ? "fa" : listenLang);
      try {
        if (opts?.cloudSpeak) {
          const audio = await opts.cloudSpeak(text, lang);
          if (audio) {
            currentAudio = audio;
            await new Promise<void>((resolve) => {
              audio.onended = () => resolve();
              audio.onerror = () => resolve();
              void audio.play().catch(() => resolve());
            });
            currentAudio = null;
            return;
          }
        }
      } catch {
        /* fall through to local */
      }
      if (tts) await localSpeak(text);
    },

    stop() {
      this.stopJarvisEars();
      if (tts) window.speechSynthesis.cancel();
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      if (stream) {
        for (const t of stream.getTracks()) t.stop();
        stream = null;
      }
      if (audioCtx) {
        void audioCtx.close().catch(() => undefined);
        audioCtx = null;
        analyser = null;
      }
      if (levelTimer != null) window.clearInterval(levelTimer);
    },

    listen() {
      return Promise.reject(new Error("از حالت جارویس همیشه-شنوا استفاده کن."));
    },
  };
}
