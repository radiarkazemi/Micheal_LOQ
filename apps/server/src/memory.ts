import type { ChatMessage } from "@micheal/protocol";

/** Short-term "consciousness" — what Micheal is holding across turns. */
export class DialogueMemory {
  private topics: string[] = [];
  private userMood: "calm" | "stressed" | "tired" | "tilted" | "unknown" = "unknown";
  private lastUserAt = 0;
  private summaryFa = "";
  private summaryEn = "";

  observe(userText: string, assistantText: string): void {
    this.lastUserAt = Date.now();
    const raw = userText.trim();
    const q = raw.toLowerCase();

    if (/(tired|خسته|خواب)/i.test(raw)) this.userMood = "tired";
    else if (/(tilt|revenge|فومو|انتقام|عصبانی)/i.test(raw)) this.userMood = "tilted";
    else if (/(stress|نگران|استرس)/i.test(raw)) this.userMood = "stressed";
    else if (raw.length > 2) this.userMood = "calm";

    const topic =
      /(طلا|xau|gold)/i.test(raw)
        ? "gold"
        : /(یورو|eur)/i.test(raw)
          ? "eurusd"
          : /(ریسک|risk|سایز)/i.test(raw)
            ? "risk"
            : /(پلن|plan|ابطال)/i.test(raw)
              ? "plan"
              : /(فوکوس|focus)/i.test(raw)
                ? "focus"
                : null;
    if (topic) {
      this.topics = [topic, ...this.topics.filter((t) => t !== topic)].slice(0, 6);
    }

    this.summaryFa = `حالت کاربر: ${this.moodFa()}. موضوع‌های اخیر: ${this.topicsFa() || "—"}. آخرین حرف تو: ${raw.slice(0, 120)}. آخرین جواب من: ${assistantText.slice(0, 120)}`;
    this.summaryEn = `User mood: ${this.userMood}. Recent topics: ${this.topics.join(", ") || "—"}. Last user: ${raw.slice(0, 120)}. Last me: ${assistantText.slice(0, 120)}`;
    void q;
  }

  fromHistory(recent: readonly ChatMessage[]): void {
    const turns = recent.slice(-6);
    for (let i = 0; i < turns.length - 1; i++) {
      const a = turns[i];
      const b = turns[i + 1];
      if (a?.role === "you" && b?.role === "micheal") this.observe(a.text, b.text);
    }
  }

  contextLine(fa: boolean): string {
    if (!this.lastUserAt && !this.topics.length) return "";
    return fa ? this.summaryFa : this.summaryEn;
  }

  moodHint(fa: boolean): string | null {
    if (this.userMood === "tilted") {
      return fa
        ? "حس می‌کنم داری به سمت تیلت می‌ری — آروم. سایز رو دست نزن."
        : "I'm picking up tilt risk — slow down. Don't touch size.";
    }
    if (this.userMood === "tired") {
      return fa
        ? "خستگی تو صدا/حرفت هست. محافظت از حساب اولویت داره."
        : "Fatigue is showing. Protecting the account comes first.";
    }
    return null;
  }

  private moodFa(): string {
    switch (this.userMood) {
      case "tired":
        return "خسته";
      case "tilted":
        return "در معرض تیلت";
      case "stressed":
        return "استرس";
      case "calm":
        return "آروم";
      default:
        return "نامشخص";
    }
  }

  private topicsFa(): string {
    const map: Record<string, string> = {
      gold: "طلا",
      eurusd: "یورو",
      risk: "ریسک",
      plan: "پلن",
      focus: "فوکوس",
    };
    return this.topics.map((t) => map[t] || t).join("، ");
  }
}
