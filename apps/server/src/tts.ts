import { request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

const TTS_URL = process.env.MICHEAL_TTS_URL?.trim() || "http://127.0.0.1:8792/v1/speak";

export async function proxySpeak(opts: {
  readonly token: string;
  readonly text: string;
  readonly lang: string;
  readonly res: ServerResponse;
}): Promise<void> {
  const url = new URL(TTS_URL);
  const payload = Buffer.from(JSON.stringify({ text: opts.text, lang: opts.lang }), "utf8");

  await new Promise<void>((resolve) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          Authorization: `Bearer ${opts.token}`,
          "X-Micheal-Token": opts.token,
        },
        timeout: 45_000,
      },
      (upstream: IncomingMessage) => {
        const chunks: Buffer[] = [];
        upstream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        upstream.on("end", () => {
          const body = Buffer.concat(chunks);
          if ((upstream.statusCode || 500) >= 400) {
            opts.res.writeHead(upstream.statusCode || 500, { "Content-Type": "application/json" });
            opts.res.end(body.length ? body : Buffer.from('{"error":"tts failed"}'));
            resolve();
            return;
          }
          opts.res.writeHead(200, {
            "Content-Type": upstream.headers["content-type"] || "audio/mpeg",
            "Content-Length": body.length,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          });
          opts.res.end(body);
          resolve();
        });
      },
    );
    req.on("error", () => {
      opts.res.writeHead(503, { "Content-Type": "application/json" });
      opts.res.end(JSON.stringify({ error: "tts unreachable" }));
      resolve();
    });
    req.on("timeout", () => {
      req.destroy();
      opts.res.writeHead(504, { "Content-Type": "application/json" });
      opts.res.end(JSON.stringify({ error: "tts timeout" }));
      resolve();
    });
    req.write(payload);
    req.end();
  });
}
