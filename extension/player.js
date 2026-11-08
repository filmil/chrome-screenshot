// SPDX-License-Identifier: Apache-2.0
// Plays a recorded video, and saves it.
import { durationText } from "./lib.js";
import { getShot } from "./store.js";

const $ = (id) => document.getElementById(id);
const video = $("video");

let shot = null; // as stored: { id, kind: "video", blob, name, duration, ... }

function report(text, isError = false) {
  $("error").textContent = isError ? text : "";
  if (!isError) $("info").textContent = text;
}

function save() {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(shot.blob);
  link.download = shot.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

// Loads `blob` into the player. A recorder writes the video as it goes, so
// the file does not say how long it is, and the player cannot seek in it.
// Seeking past the end makes Chrome read it all and find the length.
function show(blob) {
  return new Promise((resolve, reject) => {
    video.onerror = () => reject(new Error("The video could not be played."));
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration)) {
        resolve();
        return;
      }
      video.ondurationchange = () => {
        if (!Number.isFinite(video.duration)) return;
        video.ondurationchange = null;
        video.currentTime = 0;
        resolve();
      };
      video.currentTime = Number.MAX_SAFE_INTEGER;
    };
    video.src = URL.createObjectURL(blob);
  });
}

$("save").addEventListener("click", () => save());
document.addEventListener("keydown", (event) => {
  const mod = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
  if (!shot || !mod || event.key.toLowerCase() !== "s") return;
  event.preventDefault();
  save();
});

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  const stored = id && (await getShot(id));
  if (!stored || stored.kind !== "video") {
    report("This video is no longer kept. Record a new one from the extension's icon.", true);
    $("save").disabled = true;
    return;
  }
  shot = stored;
  document.title = `${stored.name} — filmil's screenshot`;
  await show(shot.blob);
  const mb = (shot.blob.size / 1e6).toFixed(1);
  report(`${video.videoWidth} × ${video.videoHeight} px, ${durationText(shot.duration)}, ${mb} MB.`);
}

init().catch((error) => report(error.message, true));

// For the end-to-end test.
globalThis.screenshotPlayer = {
  ready: () => shot !== null && video.videoWidth > 0,
  size: () => ({ width: video.videoWidth, height: video.videoHeight }),
  duration: () => video.duration,
  type: () => shot?.blob.type,
  name: () => shot?.name,
};
