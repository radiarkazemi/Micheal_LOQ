import type { ChatMessage, ClientPacket, ServerPacket, SessionState } from "@micheal/protocol";

export interface CloudState {
  readonly connected: boolean;
  readonly status: string;
  readonly session: SessionState | null;
  readonly messages: readonly ChatMessage[];
  readonly speaking: boolean;
  readonly listening: boolean;
  readonly voiceEnabled: boolean;
  readonly live: boolean;
}

type Listener = () => void;

export class MichealCloud {
  private ws: WebSocket | null = null;
  private connected = false;
  private status = "offline";
  private session: SessionState | null = null;
  private messages: ChatMessage[] = [];
  private speaking = false;
  private listening = false;
  private voiceEnabled = true;
  private live = false;
  private readonly listeners = new Set<Listener>();
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private intentionalClose = false;
  private readonly onSpeak: (text: string) => Promise<void>;
  /** Cached snapshot — must be referentially stable for useSyncExternalStore. */
  private snapshot: CloudState;

  constructor(
    private readonly url: string,
    private readonly token: string,
    onSpeak: (text: string) => Promise<void>,
  ) {
    this.onSpeak = onSpeak;
    this.snapshot = this.buildSnapshot();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): CloudState {
    return this.snapshot;
  }

  private buildSnapshot(): CloudState {
    return {
      connected: this.connected,
      status: this.status,
      session: this.session,
      messages: this.messages,
      speaking: this.speaking,
      listening: this.listening,
      voiceEnabled: this.voiceEnabled,
      live: this.live,
    };
  }

  connect(): void {
    this.intentionalClose = false;
    this.clearReconnect();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.status = "connecting";
    this.live = false;
    this.emit();

    const base = this.url.replace(/\/$/, "");
    const wsUrl = base.replace(/^http/, "ws") + "/v1/ws";
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.status = "authenticating";
      this.emit();
      this.send({ type: "hello", client: "desktop", token: this.token });
      this.startPing();
    };

    ws.onmessage = (event) => {
      void this.onPacket(JSON.parse(String(event.data)) as ServerPacket);
    };

    ws.onclose = () => {
      this.connected = false;
      this.live = false;
      this.ws = null;
      this.stopPing();
      if (this.intentionalClose) {
        this.status = "offline";
        this.emit();
        return;
      }
      this.status = "reconnecting";
      this.emit();
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      this.status = "socket error";
      this.live = false;
      this.emit();
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState < WebSocket.CLOSING) {
      ws.close();
    }
    this.connected = false;
    this.live = false;
    this.status = "offline";
    this.emit();
  }

  setVoiceEnabled(on: boolean): void {
    this.voiceEnabled = on;
    this.emit();
  }

  chat(text: string): void {
    this.send({ type: "chat", text });
  }

  /** Upload recorded audio to Germany STT (Whisper, auto fa/en). */
  async transcribe(blob: Blob, lang: "fa" | "en" | "auto" = "auto"): Promise<string> {
    const base = this.url.replace(/\/$/, "");
    const res = await fetch(`${base}/v1/stt?lang=${lang}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "X-Micheal-Token": this.token,
        "Content-Type": blob.type || "audio/webm",
        "X-Micheal-Lang": lang,
      },
      body: blob,
    });
    const data = (await res.json()) as { ok?: boolean; text?: string; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `STT ${res.status}`);
    }
    return (data.text || "").trim();
  }

  /** Neural TTS from Germany (Edge voices) — returns playable audio element. */
  async fetchSpeech(text: string, lang: "fa" | "en" = "fa"): Promise<HTMLAudioElement | null> {
    const base = this.url.replace(/\/$/, "");
    const res = await fetch(`${base}/v1/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "X-Micheal-Token": this.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, lang }),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) return null;
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    return audio;
  }

  patchSession(patch: Partial<SessionState>): void {
    this.send({ type: "session.patch", patch });
  }

  setListening(on: boolean): void {
    this.listening = on;
    this.emit();
  }

  private async onPacket(packet: ServerPacket): Promise<void> {
    switch (packet.type) {
      case "welcome":
        this.session = packet.session;
        this.status = "online";
        this.live = true;
        this.emit();
        break;
      case "session":
        this.session = packet.session;
        this.emit();
        break;
      case "status": {
        const nextLive = packet.status === "online" ? true : this.live;
        if (packet.status === this.status && nextLive === this.live) break;
        this.status = packet.status;
        if (packet.status === "online") this.live = true;
        this.emit();
        break;
      }
      case "message":
        this.messages = [...this.messages, packet.message].slice(-80);
        this.emit();
        if (packet.message.role === "micheal" && packet.message.spoken && this.voiceEnabled) {
          this.speaking = true;
          this.status = "speaking";
          this.emit();
          await this.onSpeak(packet.message.text);
          this.speaking = false;
          this.status = "online";
          this.emit();
        }
        break;
      case "error":
        this.messages = [
          ...this.messages,
          {
            id: crypto.randomUUID(),
            role: "system",
            text: packet.error,
            at: Date.now(),
          },
        ];
        this.emit();
        break;
      case "pong":
        this.live = true;
        this.emit();
        break;
    }
  }

  private send(packet: ClientPacket): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(packet));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.send({ type: "ping" });
    }, 12_000);
  }

  private stopPing(): void {
    if (this.pingTimer != null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    // Fast reconnect for always-live feel
    this.reconnectTimer = window.setTimeout(() => this.connect(), 800);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }
}
