/** Screen / TradingView vision helpers for Micheal. */

export function wantsVision(text: string): boolean {
  return /(look|see|watch|chart|trading\s*view|tradingview|screen|monitor|desktop|ببین|نگاه|چارت|تریدینگ|ویو|صفحه|مانیتور|اسکرین)/i.test(
    text,
  );
}

function jpegDataUrlFromBase64(b64: string): string {
  if (b64.startsWith("data:")) return b64;
  return `data:image/jpeg;base64,${b64}`;
}

async function captureViaElectron(): Promise<string | null> {
  const bridge = window.michealDesktop;
  if (!bridge?.captureScreen) return null;
  const raw = await bridge.captureScreen();
  if (!raw) return null;
  return jpegDataUrlFromBase64(raw);
}

/** Browser fallback: user picks a screen/window once (prefer TradingView). */
async function captureViaDisplayMedia(): Promise<string | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) return null;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) return null;
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => window.setTimeout(r, 180));
    const w = Math.min(1600, video.videoWidth || 1280);
    const h = Math.round((w / (video.videoWidth || 1)) * (video.videoHeight || 720));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  } finally {
    if (stream) for (const t of stream.getTracks()) t.stop();
  }
}

export async function captureForMicheal(): Promise<string | null> {
  const viaElectron = await captureViaElectron();
  if (viaElectron) return viaElectron;
  return captureViaDisplayMedia();
}
