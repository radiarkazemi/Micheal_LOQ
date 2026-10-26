/** Live screen / TradingView eyes for Micheal — continuous stream, not one-off uploads. */

export function wantsVision(text: string): boolean {
  return /(look|see|watch|chart|trading\s*view|tradingview|screen|monitor|desktop|live|ببین|نگاه|چارت|تریدینگ|ویو|صفحه|مانیتور|اسکرین|زنده)/i.test(
    text,
  );
}

type SourcePick = { id: string; name: string };

let liveStream: MediaStream | null = null;
let liveVideo: HTMLVideoElement | null = null;
let liveSourceName = "";
let starting: Promise<boolean> | null = null;

function jpegDataUrlFromBase64(b64: string): string {
  if (b64.startsWith("data:")) return b64;
  return `data:image/jpeg;base64,${b64}`;
}

async function frameFromVideo(video: HTMLVideoElement, maxW = 1280): Promise<string | null> {
  if (!video.videoWidth) return null;
  const w = Math.min(maxW, video.videoWidth);
  const h = Math.max(1, Math.round((w / video.videoWidth) * video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.7);
}

async function openDesktopStream(sourceId: string): Promise<MediaStream> {
  // Electron desktop capture constraint (Chromium)
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        minWidth: 1280,
        maxWidth: 1920,
        minHeight: 720,
        maxHeight: 1080,
      },
    },
  };
  return navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints);
}

async function openDisplayMediaStream(): Promise<{ stream: MediaStream; name: string }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  const name = track?.label || "display";
  track?.addEventListener("ended", () => {
    void stopLiveEyes();
  });
  return { stream, name };
}

/** Start continuous live eyes (TradingView/Chrome window preferred). */
export async function startLiveEyes(): Promise<{ ok: boolean; source: string; error?: string }> {
  if (liveStream && liveVideo) {
    return { ok: true, source: liveSourceName || "live" };
  }
  if (starting) {
    const ok = await starting;
    return ok
      ? { ok: true, source: liveSourceName || "live" }
      : { ok: false, source: "", error: "live start failed" };
  }

  starting = (async () => {
    try {
      let stream: MediaStream | null = null;
      let name = "";

      const bridge = window.michealDesktop;
      if (bridge?.pickCaptureSource) {
        const src = (await bridge.pickCaptureSource()) as SourcePick | null;
        if (src?.id) {
          try {
            stream = await openDesktopStream(src.id);
            name = src.name;
          } catch (err) {
            console.warn("[micheal] desktop stream failed, fallback", err);
          }
        }
      }

      if (!stream) {
        const picked = await openDisplayMediaStream();
        stream = picked.stream;
        name = picked.name;
      }

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      // wait for dimensions
      for (let i = 0; i < 20 && !video.videoWidth; i++) {
        await new Promise((r) => window.setTimeout(r, 50));
      }

      liveStream = stream;
      liveVideo = video;
      liveSourceName = name;
      return Boolean(video.videoWidth);
    } catch (err) {
      console.error("[micheal] startLiveEyes", err);
      await stopLiveEyes();
      return false;
    } finally {
      starting = null;
    }
  })();

  const ok = await starting;
  return ok
    ? { ok: true, source: liveSourceName }
    : {
        ok: false,
        source: "",
        error:
          "Live view failed. On Windows: Settings → Privacy → Screen recording → allow Micheal. Keep TradingView open.",
      };
}

export async function stopLiveEyes(): Promise<void> {
  if (liveStream) {
    for (const t of liveStream.getTracks()) t.stop();
  }
  liveStream = null;
  if (liveVideo) {
    liveVideo.srcObject = null;
    liveVideo = null;
  }
  liveSourceName = "";
}

export function isLiveEyesOn(): boolean {
  return Boolean(liveStream && liveVideo);
}

export function liveSourceLabel(): string {
  return liveSourceName;
}

/** Grab the current live frame (or Electron still / picker fallback). */
export async function captureForMicheal(): Promise<string | null> {
  if (!liveVideo || !liveStream) {
    const started = await startLiveEyes();
    if (!started.ok) {
      // last resort: still thumbnail from main
      const bridge = window.michealDesktop;
      if (bridge?.captureScreen) {
        const raw = await bridge.captureScreen();
        if (raw) return jpegDataUrlFromBase64(raw);
      }
      return null;
    }
  }
  if (liveVideo) {
    const frame = await frameFromVideo(liveVideo);
    if (frame) return frame;
  }
  const bridge = window.michealDesktop;
  if (bridge?.captureScreen) {
    const raw = await bridge.captureScreen();
    if (raw) return jpegDataUrlFromBase64(raw);
  }
  return null;
}
