import type { ChatMessage, ClientPacket, ServerPacket, SessionState } from "@micheal/protocol";

export interface CloudState {
  readonly connected: boolean;
  readonly status: string;
  readonly session: SessionState | null;
  readonly messages: readonly ChatMessage[];
  readonly speaking: boolean;
  readonly listening: boolean;
  readonly voiceEnabled: boolean;
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
  private readonly listeners = new Set<Listener>();
  private reconnectTimer: number | null = null;
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
    };
  }

  connect(): void {
    this.intentionalClose = false;
    this.clearReconnect();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.status = "connecting";
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
    };

    ws.onmessage = (event) => {
      void this.onPacket(JSON.parse(String(event.data)) as ServerPacket);
    };

    ws.onclose = () => {
      this.connected = false;
      this.ws = null;
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
      this.emit();
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState < WebSocket.CLOSING) {
      ws.close();
    }
    this.connected = false;
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
        this.emit();
        break;
      case "session":
        this.session = packet.session;
        this.emit();
        break;
      case "status":
        this.status = packet.status;
        this.emit();
        break;
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
        break;
    }
  }

  private send(packet: ClientPacket): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(packet));
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    this.reconnectTimer = window.setTimeout(() => this.connect(), 2500);
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
