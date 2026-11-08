// SPDX-License-Identifier: Apache-2.0
// Pure helpers, shared by the service worker and the editor, and unit-tested
// in Node. Nothing here touches the chrome.* APIs.

// Chrome lets an extension capture a tab at most twice a second.
export const CAPTURE_INTERVAL_MS = 550;

// Chrome draws no canvas wider or taller than 32767 pixels. A page image is
// also kept under 2^27 pixels (512 MB while it is drawn), so that a very
// long page does not run the extension out of memory.
export const MAX_SIDE = 32767;
export const MAX_AREA = 2 ** 27;

// The scroll positions, in CSS pixels, that show every part of a page of
// `pageWidth` x `pageHeight` through a viewport of `viewWidth` x
// `viewHeight`: row by row, top to bottom. The last row and column are
// moved back so that they end at the page's edge, as the browser scrolls.
export function planTiles(pageWidth, pageHeight, viewWidth, viewHeight) {
  if (!(viewWidth > 0 && viewHeight > 0)) throw new Error("the viewport is empty");
  const steps = (page, view) => {
    const out = [];
    const last = Math.max(0, Math.ceil(page - view));
    for (let p = 0; p < last; p += view) out.push(p);
    out.push(last);
    return out;
  };
  const xs = steps(pageWidth, viewWidth);
  return steps(pageHeight, viewHeight).flatMap((y) => xs.map((x) => ({ x, y })));
}

// The factor, at most 1, by which an image of `width` x `height` pixels
// must shrink to fit MAX_SIDE and MAX_AREA.
export function fitScale(width, height, maxSide = MAX_SIDE, maxArea = MAX_AREA) {
  const f = Math.min(1, maxSide / width, maxSide / height, Math.sqrt(maxArea / (width * height)));
  // Rounding the size up after scaling must not take it over a limit.
  return f === 1 ? 1 : Math.floor(f * 1000) / 1000;
}

// The rectangle between the points `a` and `b`, in whole pixels, kept
// inside an image of `width` x `height`.
export function rectBetween(a, b, width, height) {
  const clampX = (v) => Math.min(width, Math.max(0, Math.round(v)));
  const clampY = (v) => Math.min(height, Math.max(0, Math.round(v)));
  const x0 = clampX(Math.min(a.x, b.x));
  const x1 = clampX(Math.max(a.x, b.x));
  const y0 = clampY(Math.min(a.y, b.y));
  const y1 = clampY(Math.max(a.y, b.y));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// `rect` moved by (dx, dy), and stopped at the image's edges.
export function moveRect(rect, dx, dy, width, height) {
  return {
    ...rect,
    x: Math.min(width - rect.width, Math.max(0, Math.round(rect.x + dx))),
    y: Math.min(height - rect.height, Math.max(0, Math.round(rect.y + dy))),
  };
}

// "screenshot-example.com-2026-10-24-153012.png", in local time. The host
// is left out when it is not known. A video is "video-...", with the
// extension of its format.
export function fileName(date, url, kind = "screenshot", extension = "png") {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    + `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/[^A-Za-z0-9.-]/g, "");
  } catch {
    // No URL, or not one with a host.
  }
  return `${kind}-${host ? `${host}-` : ""}${stamp}.${extension}`;
}

// The badge while a page is captured: "40%".
export function progressText(done, total) {
  return `${Math.floor((100 * done) / Math.max(1, total))}%`;
}

// A capture's PNG, from the data: URL that Chrome returns.
export function dataUrlToBlob(url) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) throw new Error("not a base64 data: URL");
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}

// A message for the user, from an error that Chrome gives.
export function explainError(error) {
  const text = String(error?.message ?? error);
  if (/cannot (access|be scripted)|chrome:\/\/|chrome pages|extensions gallery|activeTab|permission|has not been invoked/i.test(text)) {
    return "Chrome does not let extensions capture this page. Pages such as "
      + "chrome:// pages, the Chrome Web Store, and other extensions' pages "
      + "cannot be captured.";
  }
  return text;
}

// The formats a video is recorded in, best first: MP4 plays almost
// everywhere; WebM is what every Chrome can record.
// H.264 level 5.1 (avc1.640033) covers sizes up to 4096 x 2304.
export const VIDEO_TYPES = [
  "video/mp4;codecs=avc1.640033,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm",
];

// The first of VIDEO_TYPES that `supported` (MediaRecorder.isTypeSupported)
// accepts, and the file extension that goes with it.
export function videoType(supported) {
  const type = VIDEO_TYPES.find((t) => supported(t));
  if (!type) throw new Error("This Chrome cannot record video.");
  return { type, extension: type.startsWith("video/mp4") ? "mp4" : "webm" };
}

// "1:05", or "1:02:03" for an hour or more.
export function durationText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, "0");
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = p(total % 60);
  return h ? `${h}:${p(m)}:${sec}` : `${m}:${sec}`;
}

// A recording stops by itself after 5 minutes.
export const MAX_VIDEO_MS = 5 * 60_000;

// `n`, rounded down to an even number, and at least 2: video encoders
// need even sizes.
export function even(n) {
  return Math.max(2, 2 * Math.floor(n / 2));
}
