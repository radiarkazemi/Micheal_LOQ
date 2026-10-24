import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { ChatMessage, ClientPacket, ServerPacket } from "@micheal/protocol";
import { think } from "./brain.js";
import { loadConfig } from "./config.js";
import { TradingSession } from "./session.js";

const config = loadConfig();

interface ClientCtx {
  readonly ws: WebSocket;
  readonly session: TradingSession;
  messages: ChatMessage[];
  authed: boolean;
}

const clients = new Set<ClientCtx>();

function send(ws: WebSocket, packet: ServerPacket): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(packet));
}

function pushMessage(ctx: ClientCtx, role: ChatMessage["role"], text: string, spoken = true): ChatMessage {
  const message: ChatMessage = {
    id: randomUUID(),
    role,
    text,
    at: Date.now(),
    spoken,
  };
  ctx.messages = [...ctx.messages, message].slice(-100);
  send(ctx.ws, { type: "message", message });
  return message;
}

async function handleChat(ctx: ClientCtx, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  ctx.session.touch();
  pushMessage(ctx, "you", trimmed, false);
  send(ctx.ws, { type: "status", status: "thinking" });
  const reply = await think({
    config,
    session: ctx.session.snapshot(),
    recent: ctx.messages,
    utterance: trimmed,
  });
  pushMessage(ctx, "micheal", reply.text, reply.speak);
  send(ctx.ws, { type: "status", status: "online" });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization, x-micheal-token, x-vigil-token",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function tokenFromReq(req: IncomingMessage, bodyToken?: string): string {
  const header = req.headers["x-micheal-token"] ?? req.headers["x-vigil-token"];
  if (typeof header === "string" && header) return header;
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return bodyToken?.trim() || "";
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, authorization, x-micheal-token, x-vigil-token",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: "micheal-cloud",
      region: "de-fsn",
      brain: config.openaiApiKey ? "openai" : "heuristic",
      clients: clients.size,
      time: Date.now(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as {
        text?: string;
        token?: string;
        session?: Parameters<TradingSession["patch"]>[0];
      };
      if (tokenFromReq(req, body.token) !== config.token) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      const session = new TradingSession(body.session);
      const reply = await think({
        config,
        session: session.snapshot(),
        recent: [],
        utterance: body.text || "",
      });
      json(res, 200, { reply });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : "bad request" });
    }
    return;
  }

  json(res, 404, { error: "not found" });
});

const wss = new WebSocketServer({ server, path: "/v1/ws" });

wss.on("connection", (ws) => {
  const ctx: ClientCtx = {
    ws,
    session: new TradingSession(),
    messages: [],
    authed: false,
  };
  clients.add(ctx);
  send(ws, { type: "status", status: "auth_required" });

  ws.on("message", (data) => {
    void (async () => {
      let packet: ClientPacket;
      try {
        packet = JSON.parse(String(data)) as ClientPacket;
      } catch {
        send(ws, { type: "error", error: "invalid json" });
        return;
      }

      if (packet.type === "hello") {
        if (packet.token !== config.token) {
          send(ws, { type: "error", error: "unauthorized" });
          ws.close(4401, "unauthorized");
          return;
        }
        ctx.authed = true;
        send(ws, {
          type: "welcome",
          session: ctx.session.snapshot(),
          serverTime: Date.now(),
        });
        send(ws, { type: "status", status: "online" });
        const greet = await think({
          config,
          session: ctx.session.snapshot(),
          recent: [],
        });
        pushMessage(ctx, "micheal", greet.text, greet.speak);
        return;
      }

      if (!ctx.authed) {
        send(ws, { type: "error", error: "say hello with token first" });
        return;
      }

      if (packet.type === "ping") {
        send(ws, { type: "pong", serverTime: Date.now() });
        return;
      }

      if (packet.type === "session.patch") {
        const hint = ctx.session.patch(packet.patch);
        send(ws, { type: "session", session: ctx.session.snapshot() });
        if (hint) {
          const focus = ctx.session.snapshot().focusMode;
          if (!(focus && hint.priority === "low")) {
            pushMessage(ctx, "micheal", hint.text, true);
          }
        }
        return;
      }

      if (packet.type === "chat") {
        await handleChat(ctx, packet.text);
      }
    })().catch((err) => {
      console.error("[micheal] handler error", err);
      send(ws, { type: "error", error: "internal error" });
      send(ws, { type: "status", status: "online" });
    });
  });

  ws.on("close", () => {
    clients.delete(ctx);
  });
});

setInterval(() => {
  for (const ctx of clients) {
    if (!ctx.authed) continue;
    const hint = ctx.session.checkIdle();
    if (hint) pushMessage(ctx, "micheal", hint.text, true);
  }
}, 30_000);

server.listen(config.port, config.host, () => {
  console.log(
    `[micheal] cloud brain listening on http://${config.host}:${config.port}  brain=${config.openaiApiKey ? "openai" : "heuristic"}`,
  );
});
