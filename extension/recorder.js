// SPDX-License-Identifier: Apache-2.0
// Records a tab, in the extension's offscreen page: a service worker
// cannot use MediaRecorder. The worker opens this page for one recording
// and closes it after. The video goes to the extension's own storage, as a
// screenshot does, and the worker opens it in a tab.
import { MAX_VIDEO_MS, MIN_VIDEO_MS, even, fileName, videoType } from "./lib.js";
import { putShot } from "./store.js";

// The recording, from start until its video is kept or lost:
// { recorder, stream, audio, chunks, started, tabId, url, type, extension,
//   done, stopping, timer }.
let recording = null;

async function start({ streamId, tabId, url, width, height, sound }) {
  if (recording) throw new Error("A video is already being recorded.");
  const source = { chromeMediaSource: "tab", chromeMediaSourceId: streamId };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: sound ? { mandatory: source } : false,
    video: {
      mandatory: {
        ...source,
        // The tab's own size in device pixels, so the video is as sharp as
        // the screen. Video encoders need even sizes.
        maxWidth: even(width),
        maxHeight: even(height),
        maxFrameRate: 30,
      },
    },
  });
  let audio = null;
  try {
    // Capturing a tab's sound mutes the tab; play it on, so the user
    // still hears it.
    if (stream.getAudioTracks().length) {
      audio = new AudioContext();
      audio.createMediaStreamSource(stream).connect(audio.destination);
    }
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
    recorder.onerror = () => finish();
    recorder.start(1000);
    recording = {
      recorder, stream, audio, chunks, started: Date.now(), tabId, url, type, extension, done,
      stopping: false,
      // Recordings stop by themselves at the time limit.
      timer: setTimeout(() => finish(), MAX_VIDEO_MS),
    };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    await audio?.close().catch(() => {});
    throw error;
  }
  // The tab closing, or going where Chrome does not let it be captured,
  // ends the stream; the recording ends with it.
  for (const track of stream.getTracks()) track.onended = () => finish();
  return { started: recording.started };
}

// Ends the recording, keeps the video, and tells the worker its id. The
// recording stays in `recording`, marked as stopping, until then, so that
// nothing can start or stop another one meanwhile.
async function stop() {
  const r = recording;
  if (!r || r.stopping) return;
  r.stopping = true;
  clearTimeout(r.timer);
  try {
    // A video stopped in its first moments can hold no frame, and then no
    // player can play it; so it runs for at least a second.
    const wait = r.started + MIN_VIDEO_MS - Date.now();
    if (wait > 0 && r.recorder.state !== "inactive") await new Promise((ok) => setTimeout(ok, wait));
    if (r.recorder.state !== "inactive") r.recorder.stop();
    await r.done;
    for (const track of r.stream.getTracks()) track.stop();
    await r.audio?.close().catch(() => {});
    const video = {
      id: crypto.randomUUID(),
      kind: "video",
      blob: new Blob(r.chunks, { type: r.type.split(";")[0] }),
      // When it was kept: the worker deletes what no tab shows a minute
      // after this.
      created: Date.now(),
      name: fileName(new Date(r.started), r.url, "video", r.extension),
      duration: Date.now() - r.started,
    };
    await putShot(video);
    const reply = await chrome.runtime.sendMessage(
      { target: "worker", type: "recorded", id: video.id, tabId: r.tabId });
    if (!reply?.ok) throw new Error(reply?.error ?? "the extension did not open it");
  } finally {
    recording = null;
  }
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
    status: async () => (recording
      ? { tabId: recording.tabId, started: recording.started, stopping: recording.stopping,
        limit: MAX_VIDEO_MS }
      : null),
  }[message.type];
  if (!work) return false;
  work().then(
    (result) => reply({ ok: true, result }),
    (error) => reply({ ok: false, error: error.message }),
  );
  return true;
});
