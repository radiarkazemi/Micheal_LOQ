import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { think } from "./brain.js";
import { loadConfig } from "./config.js";
import { detectLang } from "./lang.js";
import { observeAmbient } from "./observe.js";
import { TradingSession } from "./session.js";
const config = loadConfig();
const here = fileURLToPath(new URL(".", import.meta.url));
const HUD_DIR = resolve(process.env.MICHEAL_HUD_DIR?.trim() ||
    join(here, "..", "hud") ||
    join(here, "hud"));
const DOWNLOAD_DIR = resolve(process.env.MICHEAL_DOWNLOAD_DIR?.trim() || join(here, "..", "download"));
const clients = new Set();
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".exe": "application/octet-stream",
    ".zip": "application/zip",
    ".yml": "text/yaml; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
};
function send(ws, packet) {
    if (ws.readyState === ws.OPEN)
        ws.send(JSON.stringify(packet));
}
function pushMessage(ctx, role, text, spoken = true) {
    const message = {
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
async function handleChat(ctx, text) {
    const trimmed = text.trim();
    if (!trimmed)
        return;
    const lang = detectLang(trimmed);
    ctx.session.setLang(lang);
    ctx.session.touch();
    pushMessage(ctx, "you", trimmed, false);
    send(ctx.ws, { type: "status", status: "thinking" });
    const reply = await think({
        config,
        session: ctx.session.snapshot(),
        recent: ctx.messages,
        utterance: trimmed,
        preferredLang: lang,
    });
    pushMessage(ctx, "micheal", reply.text, reply.speak);
    ctx.lastSpokeAt = Date.now();
    send(ctx.ws, { type: "status", status: "online" });
}
function cors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-micheal-token, x-vigil-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}
function json(res, status, body) {
    const payload = JSON.stringify(body);
    cors(res);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(payload);
}
function readBody(req) {
    return new Promise((resolveBody, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
function tokenFromReq(req, bodyToken) {
    const header = req.headers["x-micheal-token"] ?? req.headers["x-vigil-token"];
    if (typeof header === "string" && header)
        return header;
    const auth = req.headers.authorization;
    if (auth?.toLowerCase().startsWith("bearer "))
        return auth.slice(7).trim();
    return bodyToken?.trim() || "";
}
function safeJoin(root, reqPath) {
    const cleaned = normalize(decodeURIComponent(reqPath)).replace(/^(\.\.[/\\])+/, "");
    const full = resolve(root, cleaned);
    if (!full.startsWith(root))
        return null;
    return full;
}
function sendFile(res, filePath, cache = "public, max-age=300") {
    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const stat = statSync(filePath);
    cors(res);
    res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": stat.size,
        "Cache-Control": ext === ".html" ? "no-cache" : cache,
    });
    createReadStream(filePath).pipe(res);
}
function tryStatic(res, root, urlPath) {
    if (!existsSync(root))
        return false;
    let rel = urlPath.replace(/^\//, "");
    if (!rel || rel.endsWith("/"))
        rel = join(rel, "index.html");
    const file = safeJoin(root, rel);
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
        // SPA fallback
        const index = join(root, "index.html");
        if (existsSync(index) && !urlPath.startsWith("/v1/") && !urlPath.startsWith("/download/")) {
            sendFile(res, index, "no-cache");
            return true;
        }
        return false;
    }
    sendFile(res, file);
    return true;
}
const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
        cors(res);
        res.writeHead(204);
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
            hud: existsSync(join(HUD_DIR, "index.html")),
            jarvis: true,
            time: Date.now(),
        });
        return;
    }
    // Auto-link HUD/Electron with zero typing — token comes from server env.
    if (req.method === "GET" && url.pathname === "/v1/bootstrap") {
        json(res, 200, {
            ok: true,
            jarvis: true,
            url: `http://${req.headers.host || "91.107.171.162:8787"}`.replace(/\/$/, ""),
            token: config.token,
            alwaysOn: true,
            ambient: true,
        });
        return;
    }
    if (req.method === "GET" && url.pathname === "/v1/live") {
        json(res, 200, {
            ok: true,
            live: true,
            clients: clients.size,
            time: Date.now(),
        });
        return;
    }
    if (req.method === "POST" && url.pathname === "/v1/chat") {
        try {
            const raw = await readBody(req);
            const body = JSON.parse(raw || "{}");
            if (tokenFromReq(req, body.token) !== config.token) {
                json(res, 401, { error: "unauthorized" });
                return;
            }
            const session = new TradingSession(body.session);
            const lang = detectLang(body.text || "");
            session.setLang(lang);
            const reply = await think({
                config,
                session: session.snapshot(),
                recent: [],
                utterance: body.text || "",
                preferredLang: lang,
            });
            json(res, 200, { reply });
        }
        catch (err) {
            json(res, 400, { error: err instanceof Error ? err.message : "bad request" });
        }
        return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/download/")) {
        const rel = url.pathname.slice("/download/".length);
        const file = safeJoin(DOWNLOAD_DIR, rel);
        if (file && existsSync(file) && statSync(file).isFile()) {
            sendFile(res, file, "public, max-age=60");
            return;
        }
        json(res, 404, { error: "download not found" });
        return;
    }
    if (req.method === "GET") {
        if (tryStatic(res, HUD_DIR, url.pathname))
            return;
    }
    json(res, 404, { error: "not found" });
});
const wss = new WebSocketServer({ server, path: "/v1/ws" });
wss.on("connection", (ws) => {
    const ctx = {
        ws,
        session: new TradingSession(),
        messages: [],
        authed: false,
        lastPongAt: Date.now(),
        lastSpokeAt: 0,
        observing: false,
    };
    clients.add(ctx);
    send(ws, { type: "status", status: "auth_required" });
    ws.on("message", (data) => {
        void (async () => {
            let packet;
            try {
                packet = JSON.parse(String(data));
            }
            catch {
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
                ctx.lastPongAt = Date.now();
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
                    preferredLang: ctx.session.getLang(),
                });
                pushMessage(ctx, "micheal", greet.text, greet.speak);
                ctx.lastSpokeAt = Date.now();
                return;
            }
            if (!ctx.authed) {
                send(ws, { type: "error", error: "say hello with token first" });
                return;
            }
            if (packet.type === "ping") {
                ctx.lastPongAt = Date.now();
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
                        ctx.lastSpokeAt = Date.now();
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
// Continuous Jarvis awareness — watch session without waiting for user input
setInterval(() => {
    for (const ctx of clients) {
        if (!ctx.authed || ctx.observing)
            continue;
        void (async () => {
            ctx.observing = true;
            try {
                const idle = ctx.session.checkIdle();
                if (idle) {
                    pushMessage(ctx, "micheal", idle.text, true);
                    ctx.lastSpokeAt = Date.now();
                    return;
                }
                const obs = observeAmbient({
                    session: ctx.session.snapshot(),
                    recent: ctx.messages,
                    lang: ctx.session.getLang(),
                    lastSpokeAt: ctx.lastSpokeAt,
                });
                if (obs) {
                    pushMessage(ctx, "micheal", obs.text, obs.speak);
                    ctx.lastSpokeAt = Date.now();
                }
            }
            finally {
                ctx.observing = false;
            }
        })();
    }
}, 20_000);
// Live keepalive: drop dead sockets fast so reconnects stay snappy
setInterval(() => {
    const now = Date.now();
    for (const ctx of clients) {
        if (!ctx.authed)
            continue;
        if (now - ctx.lastPongAt > 45_000) {
            try {
                ctx.ws.terminate();
            }
            catch {
                /* ignore */
            }
            clients.delete(ctx);
            continue;
        }
        send(ctx.ws, { type: "status", status: "online" });
    }
}, 15_000);
server.listen(config.port, config.host, () => {
    console.log(`[micheal] cloud brain listening on http://${config.host}:${config.port}  brain=${config.openaiApiKey ? "openai" : "heuristic"} hud=${HUD_DIR}`);
});
