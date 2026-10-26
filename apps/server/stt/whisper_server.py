#!/usr/bin/env python3
"""Micheal STT — bilingual Whisper (fa/en auto). Accepts WAV/WebM/OGG via ffmpeg."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from faster_whisper import WhisperModel

HOST = os.environ.get("MICHEAL_STT_HOST", "127.0.0.1")
PORT = int(os.environ.get("MICHEAL_STT_PORT", "8791"))
MODEL_NAME = os.environ.get("MICHEAL_STT_MODEL", "base")
TOKEN = os.environ.get("MICHEAL_TOKEN", "").strip()
INITIAL = (
    "Micheal trading Jarvis for Mohammad. Persian فارسی and English. "
    "طلا XAUUSD یورو دلار EURUSD پوند GBPUSD تایم فریم پانزده شصت. "
    "Hey Micheal هی مایکل هی میشل محمد."
)

print(f"[micheal-stt] loading model={MODEL_NAME} …", flush=True)
MODEL = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
print("[micheal-stt] ready", flush=True)


def to_wav16k(src: Path) -> Path:
    """Normalize any browser blob to 16kHz mono WAV for Whisper."""
    dst = src.with_suffix(".wav16.wav")
    # Prefer clean convert; fall back to ignoring decode errors (broken webm slices)
    cmds = [
        [
            "ffmpeg",
            "-y",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(dst),
        ],
        [
            "ffmpeg",
            "-y",
            "-err_detect",
            "ignore_err",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(dst),
        ],
    ]
    last_err = ""
    for cmd in cmds:
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode == 0 and dst.exists() and dst.stat().st_size > 44:
            return dst
        last_err = (proc.stderr or proc.stdout or "ffmpeg failed")[-400:]
    raise RuntimeError(f"audio decode failed: {last_err}")


def transcribe(path: str, language: str | None) -> tuple[str, str | None]:
    lang = None if not language or language in ("auto", "mixed") else language
    segments, info = MODEL.transcribe(
        path,
        language=lang,
        task="transcribe",
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400),
        beam_size=3,
        best_of=3,
        temperature=0.0,
        condition_on_previous_text=False,
        initial_prompt=INITIAL,
    )
    text = " ".join(seg.text.strip() for seg in segments).strip()
    detected = getattr(info, "language", None)
    return text, detected


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(f"[micheal-stt] {self.address_string()} {fmt % args}", flush=True)

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
                {"ok": True, "service": "micheal-stt", "model": MODEL_NAME, "bilingual": True}
            ).encode()
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
        lang_hdr = (self.headers.get("X-Micheal-Lang") or "auto").strip().lower()
        suffix = ".bin"
        if "wav" in ctype:
            suffix = ".wav"
        elif "webm" in ctype:
            suffix = ".webm"
        elif "ogg" in ctype:
            suffix = ".ogg"
        elif "mp4" in ctype or "m4a" in ctype:
            suffix = ".m4a"
        elif "mpeg" in ctype or "mp3" in ctype:
            suffix = ".mp3"

        tmp: Path | None = None
        wav: Path | None = None
        try:
            fd, name = tempfile.mkstemp(prefix="micheal-stt-", suffix=suffix)
            os.close(fd)
            tmp = Path(name)
            tmp.write_bytes(raw)

            # Always normalize through ffmpeg → stable PCM for Whisper
            if suffix == ".wav" and len(raw) > 44 and raw[:4] == b"RIFF":
                # already WAV — still resample to 16k
                wav = to_wav16k(tmp)
            else:
                wav = to_wav16k(tmp)

            text, detected = transcribe(str(wav), lang_hdr)
            body = json.dumps(
                {"ok": True, "text": text, "lang": detected or lang_hdr, "model": MODEL_NAME},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            msg = str(exc)
            # Friendlier client message for the common broken-webm case
            if "Invalid data found" in msg or "audio decode failed" in msg:
                msg = "audio decode failed — send a complete clip (WAV preferred)"
            body = json.dumps({"ok": False, "error": msg}, ensure_ascii=False).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        finally:
            if tmp and tmp.exists():
                tmp.unlink(missing_ok=True)
            if wav and wav.exists():
                wav.unlink(missing_ok=True)


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[micheal-stt] listening on http://{HOST}:{PORT}", flush=True)
    httpd.serve_forever()
