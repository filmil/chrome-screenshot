// SPDX-License-Identifier: Apache-2.0
import { durationText } from "./lib.js";

const $ = (id) => document.getElementById(id);
const buttons = ["visible", "page", "record", "stop"];

async function ask(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error ?? "No reply from the extension.");
  return reply.result;
}

const statusText = {
  page: "Scrolling through the page…",
  visible: "Taking the screenshot…",
  record: "Starting the recording…",
  stop: "Stopping the recording…",
};

// Sends `type` ("capture", "record" or "stop") for this tab, and closes
// the popup when it worked.
async function run(type, mode) {
  $("error").textContent = "";
  for (const id of buttons) $(id).disabled = true;
  $("status").textContent = statusText[mode ?? type];
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No tab to capture.");
    await ask({ type, mode, tabId: tab.id });
    window.close();
  } catch (e) {
    $("status").textContent = "";
    $("error").textContent = e.message;
    for (const id of buttons) $(id).disabled = false;
  }
}

$("visible").addEventListener("click", () => run("capture", "visible"));
$("page").addEventListener("click", () => run("capture", "page"));
$("record").addEventListener("click", () => run("record"));
$("stop").addEventListener("click", () => run("stop"));

// While a video is recorded, the popup offers only to stop it.
async function init() {
  const recording = await ask({ type: "status" }).catch(() => null);
  if (!recording) return;
  $("idle").hidden = true;
  $("recording").hidden = false;
  const tick = () => {
    $("elapsed").textContent = `Recording a video: ${durationText(Date.now() - recording.started)}.`;
  };
  tick();
  setInterval(tick, 1000);
}

init();
