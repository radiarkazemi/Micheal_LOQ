const PERSIAN_RE = /[\u0600-\u06FF]/;

export interface JarvisEarsOpts {
  onLevel?: (level: number) => void;
  onUtterance: (blob: Blob) => void | Promise<void>;
  shouldListen?: () => boolean;
}

export interface Voice {
  readonly supported: { readonly tts: boolean; readonly stt: boolean; readonly media: boolean };
  speak(
    text: string,
    opts?: {
      lang?: "fa" | "en";
      cloudSpeak?: (t: string, lang: "fa" | "en") => Promise<HTMLAudioElement | null>;
    },
  ): Promise<void>;
  stop(): void;
  startJarvisEars(opts: JarvisEarsOpts): Promise<void>;
  stopJarvisEars(): void;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  setListenLang(lang: "en" | "fa"): void;
  setPaused(paused: boolean): void;
  isPaused(): boolean;
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
  return "";
}

/** Build a valid WAV (16-bit PCM mono) from Float32 samples — Whisper-friendly. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
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
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;

  let jarvisOn = false;
  let jarvisOpts: JarvisEarsOpts | null = null;
  let tickTimer: number | null = null;

  let inSpeech = false;
  let speechMs = 0;
  let silenceMs = 0;
  let lastEmitAt = 0;
  let processing = false;
  let manualRecording = false;
  let currentAudio: HTMLAudioElement | null = null;

  /** PCM capture while inSpeech */
  let pcm: Float32Array[] = [];
  let pcmSamples = 0;

  const SPEECH_ON = 0.035;
  const SPEECH_OFF = 0.02;
  const MIN_SPEECH_MS = 450;
  const END_SILENCE_MS = 900;
  const MAX_UTTER_MS = 12_000;
  const TICK_MS = 100;
  const MAX_PCM_SAMPLES = 16000 * 15; // ~15s @16k

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
    inSpeech = false;
    speechMs = 0;
    silenceMs = 0;
    pcm = [];
    pcmSamples = 0;
  };

  const emitUtterance = async () => {
    if (processing || !jarvisOpts) return;
    if (speechMs < MIN_SPEECH_MS || pcmSamples < 2000) {
      resetUtteranceBuffer();
      return;
    }
    if (Date.now() - lastEmitAt < 700) {
      resetUtteranceBuffer();
      return;
    }

    const rate = audioCtx?.sampleRate || 48000;
    const merged = new Float32Array(pcmSamples);
    let off = 0;
    for (const part of pcm) {
      merged.set(part, off);
      off += part.length;
    }
    resetUtteranceBuffer();

    // Downsample to 16k for smaller upload + Whisper native rate
    const targetRate = 16000;
    const ratio = rate / targetRate;
    const outLen = Math.floor(merged.length / ratio);
    const down = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      down[i] = merged[Math.floor(i * ratio)]!;
    }
    const blob = encodeWav(down, targetRate);
    if (blob.size < 1000) return;

    processing = true;
    lastEmitAt = Date.now();
    paused = true;
    try {
      await jarvisOpts.onUtterance(blob);
    } finally {
      processing = false;
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
      }
      if (audioCtx.state === "suspended") await audioCtx.resume();

      if (!sourceNode) {
        sourceNode = audioCtx.createMediaStreamSource(s);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        sourceNode.connect(analyser);

        // PCM tap for valid WAV utterances (avoids broken WebM slices)
        processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (ev) => {
          if (!jarvisOn || paused || processing || !inSpeech) return;
          if (opts.shouldListen && !opts.shouldListen()) return;
          const input = ev.inputBuffer.getChannelData(0);
          const copy = new Float32Array(input.length);
          copy.set(input);
          pcm.push(copy);
          pcmSamples += copy.length;
          if (pcmSamples > MAX_PCM_SAMPLES) {
            // drop oldest
            while (pcmSamples > MAX_PCM_SAMPLES && pcm.length) {
              const dropped = pcm.shift()!;
              pcmSamples -= dropped.length;
            }
          }
        };
        sourceNode.connect(processor);
        processor.connect(audioCtx.destination); // required in some Chromium builds; keep gain silent
        const mute = audioCtx.createGain();
        mute.gain.value = 0;
        processor.disconnect();
        sourceNode.connect(processor);
        processor.connect(mute);
        mute.connect(audioCtx.destination);
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
            pcm = [];
            pcmSamples = 0;
          }
          speechMs += TICK_MS;
          silenceMs = 0;
          if (speechMs >= MAX_UTTER_MS) void emitUtterance();
        } else if (inSpeech) {
          silenceMs += TICK_MS;
          if (silenceMs >= END_SILENCE_MS) void emitUtterance();
        }
      }, TICK_MS);

      void pickMime(); // keep helper referenced for future MediaRecorder fallback
    },

    stopJarvisEars() {
      jarvisOn = false;
      jarvisOpts = null;
      stopTick();
      resetUtteranceBuffer();
      if (processor) {
        try {
          processor.disconnect();
        } catch {
          /* ignore */
        }
        processor = null;
      }
      if (sourceNode) {
        try {
          sourceNode.disconnect();
        } catch {
          /* ignore */
        }
        sourceNode = null;
      }
      analyser = null;
    },

    async startRecording(onLevel) {
      manualRecording = true;
      await this.startJarvisEars({
        onLevel,
        onUtterance: () => undefined,
      });
      inSpeech = true;
      paused = false;
    },

    async stopRecording() {
      manualRecording = false;
      const rate = audioCtx?.sampleRate || 48000;
      const merged = new Float32Array(pcmSamples);
      let off = 0;
      for (const part of pcm) {
        merged.set(part, off);
        off += part.length;
      }
      const ratio = rate / 16000;
      const outLen = Math.max(0, Math.floor(merged.length / ratio));
      const down = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) down[i] = merged[Math.floor(i * ratio)]!;
      resetUtteranceBuffer();
      return encodeWav(down, 16000);
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
        /* local fallback */
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
      }
    },

    listen() {
      return Promise.reject(new Error("از حالت جارویس همیشه-شنوا استفاده کن."));
    },
  };
}
