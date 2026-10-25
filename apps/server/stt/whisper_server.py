#!/usr/bin/env python3
"""Local Persian STT for Micheal — Electron cannot use Chrome Web Speech."""

from __future__ import annotations

import json
import os
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from faster_whisper import WhisperModel

HOST = os.environ.get("MICHEAL_STT_HOST", "127.0.0.1")
PORT = int(os.environ.get("MICHEAL_STT_PORT", "8791"))
MODEL_NAME = os.environ.get("MICHEAL_STT_MODEL", "tiny")
TOKEN = os.environ.get("MICHEAL_TOKEN", "").strip()

print(f"[micheal-stt] loading model={MODEL_NAME} …", flush=True)
MODEL = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
print("[micheal-stt] ready", flush=True)


def transcribe(path: str, language: str | None) -> str:
    segments, _info = MODEL.transcribe(
        path,
        language=language or "fa",
        vad_filter=True,
        beam_size=1,
    )
    return " ".join(seg.text.strip() for seg in segments).strip()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # quieter
        print(f"[micheal-stt] {self.address_string()} {fmt % args}", flush=True)

    def _auth_ok(self) -> bool:
        if not TOKEN:
            return True
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer ") and auth[7:].strip() == TOKEN:
            return True
        if self.headers.get("X-Micheal-Token", "") == TOKEN:
            return True
        return False

    def do_GET(self) -> None:
        if self.path.startswith("/health"):
            body = json.dumps({"ok": True, "service": "micheal-stt", "model": MODEL_NAME}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if not self.path.startswith("/v1/transcribe"):
            self.send_error(404)
            return
        if not self._auth_ok():
            self.send_error(401, "unauthorized")
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 25 * 1024 * 1024:
            self.send_error(400, "bad audio size")
            return
        raw = self.rfile.read(length)
        ctype = (self.headers.get("Content-Type") or "").lower()
        lang = self.headers.get("X-Micheal-Lang") or "fa"
        suffix = ".webm"
        if "wav" in ctype:
            suffix = ".wav"
        elif "ogg" in ctype:
            suffix = ".ogg"
        elif "mp4" in ctype or "m4a" in ctype:
            suffix = ".m4a"
        elif "mpeg" in ctype or "mp3" in ctype:
            suffix = ".mp3"

        tmp: Path | None = None
        try:
            fd, name = tempfile.mkstemp(prefix="micheal-stt-", suffix=suffix)
            os.close(fd)
            tmp = Path(name)
            tmp.write_bytes(raw)
            text = transcribe(str(tmp), lang if lang != "auto" else None)
            body = json.dumps({"ok": True, "text": text, "lang": lang}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            body = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        finally:
            if tmp and tmp.exists():
                tmp.unlink(missing_ok=True)


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[micheal-stt] listening on http://{HOST}:{PORT}", flush=True)
    httpd.serve_forever()
