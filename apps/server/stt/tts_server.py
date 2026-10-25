#!/usr/bin/env python3
"""Micheal TTS — Edge neural voices (Persian + English)."""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import edge_tts

HOST = os.environ.get("MICHEAL_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("MICHEAL_TTS_PORT", "8792"))
TOKEN = os.environ.get("MICHEAL_TOKEN", "").strip()
FA_VOICE = os.environ.get("MICHEAL_TTS_FA", "fa-IR-FaridNeural")
EN_VOICE = os.environ.get("MICHEAL_TTS_EN", "en-GB-RyanNeural")
PERSIAN_RE = re.compile(r"[\u0600-\u06FF]")


async def synth(text: str, lang: str) -> bytes:
    voice = FA_VOICE if lang == "fa" or PERSIAN_RE.search(text) else EN_VOICE
    communicate = edge_tts.Communicate(text, voice)
    fd, name = tempfile.mkstemp(prefix="micheal-tts-", suffix=".mp3")
    os.close(fd)
    path = Path(name)
    try:
        await communicate.save(str(path))
        return path.read_bytes()
    finally:
        path.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(f"[micheal-tts] {self.address_string()} {fmt % args}", flush=True)

    def _auth_ok(self) -> bool:
        if not TOKEN:
            return True
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer ") and auth[7:].strip() == TOKEN:
            return True
        return self.headers.get("X-Micheal-Token", "") == TOKEN

    def do_GET(self) -> None:
        if self.path.startswith("/health"):
            body = json.dumps(
                {"ok": True, "service": "micheal-tts", "fa": FA_VOICE, "en": EN_VOICE}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if not self.path.startswith("/v1/speak"):
            self.send_error(404)
            return
        if not self._auth_ok():
            self.send_error(401, "unauthorized")
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 20_000:
            self.send_error(400, "bad body")
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            text = (payload.get("text") or "").strip()
            lang = (payload.get("lang") or "fa").strip().lower()
            if not text:
                self.send_error(400, "empty text")
                return
            # Keep spoken replies snappy
            if len(text) > 600:
                text = text[:600]
            audio = asyncio.run(synth(text, lang))
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("X-Micheal-Voice", FA_VOICE if lang == "fa" else EN_VOICE)
            self.end_headers()
            self.wfile.write(audio)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            self.send_error(500, "tts failed")


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[micheal-tts] listening on http://{HOST}:{PORT}", flush=True)
    httpd.serve_forever()
