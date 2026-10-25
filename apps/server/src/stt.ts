import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";

const STT_URL = process.env.MICHEAL_STT_URL?.trim() || "http://127.0.0.1:8791/v1/transcribe";

export async function transcribeAudio(opts: {
  readonly token: string;
  readonly body: Buffer;
  readonly contentType: string;
  readonly lang?: string;
}): Promise<{ text: string; lang?: string } | { error: string }> {
  const url = new URL(STT_URL);
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": opts.contentType || "audio/webm",
          "Content-Length": opts.body.length,
          Authorization: `Bearer ${opts.token}`,
          "X-Micheal-Token": opts.token,
          "X-Micheal-Lang": opts.lang || "auto",
        },
        timeout: 90_000,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            const data = JSON.parse(raw) as {
              ok?: boolean;
              text?: string;
              error?: string;
              lang?: string;
            };
            if (data.ok && typeof data.text === "string") {
              resolve({ text: data.text, lang: data.lang });
            } else resolve({ error: data.error || "stt failed" });
          } catch {
            resolve({ error: `bad stt response (${res.statusCode})` });
          }
        });
      },
    );
    req.on("error", (err) => resolve({ error: err.message || "stt unreachable" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "stt timeout" });
    });
    req.write(opts.body);
    req.end();
  });
}

export async function readRawBody(req: IncomingMessage, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += buf.length;
      if (total > maxBytes) {
        reject(new Error("audio too large"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
