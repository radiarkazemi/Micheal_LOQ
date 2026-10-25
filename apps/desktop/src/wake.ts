/** Wake-word + conversation window (Jarvis / Siri style). */

const WAKE_EN =
  /(?:^|[\s,،.!?])(?:(?:hey|hi|ok|okay)\s+)?(?:micheal|michael|michel|jarvis)(?:[\s,،.!?؟]|$)/i;

const WAKE_FA =
  /(?:^|[\s,،.!?؟])(?:(?:هی|های|هِی|هوی)\s*)?(?:میشل|ميشل|جارویس)(?:[\s,،.!?؟]|$)/;

export interface WakeResult {
  readonly awake: boolean;
  readonly command: string;
  readonly wokeNow: boolean;
}

export class WakeGate {
  private until = 0;
  private readonly windowMs: number;

  constructor(windowMs = 75_000) {
    this.windowMs = windowMs;
  }

  get isConversationOpen(): boolean {
    return Date.now() < this.until;
  }

  keepAlive(): void {
    this.until = Date.now() + this.windowMs;
  }

  close(): void {
    this.until = 0;
  }

  handle(transcript: string): WakeResult {
    const raw = transcript.trim();
    if (!raw) return { awake: false, command: "", wokeNow: false };

    const hitEn = WAKE_EN.test(raw);
    const hitFa = WAKE_FA.test(raw);
    if (hitEn || hitFa) {
      const command = raw
        .replace(WAKE_EN, " ")
        .replace(WAKE_FA, " ")
        .replace(/^[\s,،.!?؟]+/, "")
        .trim();
      this.keepAlive();
      return { awake: true, command, wokeNow: true };
    }

    if (this.isConversationOpen) {
      this.keepAlive();
      return { awake: true, command: raw, wokeNow: false };
    }

    return { awake: false, command: "", wokeNow: false };
  }
}
