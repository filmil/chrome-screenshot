// SPDX-License-Identifier: Apache-2.0
// Records a tab, in the extension's offscreen page: a service worker
// cannot use MediaRecorder. The worker opens this page for one recording
// and closes it after. The video goes to the extension's own storage, as a
// screenshot does, and the worker opens it in a tab.
import { fileName, videoType } from "./lib.js";
import { putShot } from "./store.js";

let recording = null; // { recorder, stream, audio, chunks, started, tabId, done }

async function start({ streamId, tabId, url, width, height }) {
  if (recording) throw new Error("A video is already being recorded.");
  const source = { chromeMediaSource: "tab", chromeMediaSourceId: streamId };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: source },
    video: {
      mandatory: {
        ...source,
        // The tab's own size in device pixels, so the video is as sharp as
        // the screen.
        maxWidth: width,
        maxHeight: height,
        maxFrameRate: 30,
      },
    },
  });
  // Capturing a tab mutes it; play its sound on, so the user still hears it.
  const audio = new AudioContext();
  audio.createMediaStreamSource(stream).connect(audio.destination);
  const { type, extension } = videoType((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, { mimeType: type });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  let finished;
  const done = new Promise((resolve) => {
    finished = resolve;
  });
  recorder.onstop = () => finished();
  recording = { recorder, stream, audio, chunks, started: Date.now(), tabId, url, extension, type, done };
  // The tab closing, or going where Chrome does not let it be captured,
  // ends the stream; the recording ends with it.
  for (const track of stream.getTracks()) track.onended = () => finish();
  recorder.start(1000);
  return { started: recording.started };
}

// Ends the recording, keeps the video, and tells the worker its id.
async function stop() {
  const r = recording;
  if (!r) return null;
  if (r.recorder.state !== "inactive") r.recorder.stop();
  await r.done;
  if (recording !== r) return null; // the other caller kept it
  recording = null;
  for (const track of r.stream.getTracks()) track.stop();
  await r.audio.close().catch(() => {});
  const blob = new Blob(r.chunks, { type: r.type.split(";")[0] });
  const video = {
    id: crypto.randomUUID(),
    kind: "video",
    blob,
    created: r.started,
    name: fileName(new Date(r.started), r.url, "video", r.extension),
    duration: Date.now() - r.started,
  };
  await putShot(video);
  await chrome.runtime.sendMessage({ target: "worker", type: "recorded", id: video.id, tabId: r.tabId });
  return { id: video.id };
}

// Stops the recording, and tells the worker if the video could not be kept.
function finish() {
  const tabId = recording?.tabId;
  stop().catch((error) => chrome.runtime.sendMessage({
    target: "worker", type: "record-failed", tabId, error: `The video was lost: ${error.message}`,
  }));
}

// Only the worker sends these, with target "recorder".
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.target !== "recorder") return false;
  const work = {
    start: () => start(message),
    // Answers at once; stop() sends "recorded" when the video is kept.
    stop: async () => {
      if (!recording) throw new Error("No video is being recorded.");
      finish();
      return null;
    },
    status: async () => (recording ? { tabId: recording.tabId, started: recording.started } : null),
  }[message.type];
  if (!work) return false;
  work().then(
    (result) => reply({ ok: true, result }),
    (error) => reply({ ok: false, error: error.message }),
  );
  return true;
});
