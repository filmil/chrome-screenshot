// SPDX-License-Identifier: Apache-2.0
// Shows a screenshot, lets the user select part of it by dragging, and
// saves or copies the selection, or the whole image when nothing is
// selected.
import { moveRect, rectBetween } from "./lib.js";
import { getShot, putShot } from "./store.js";

const $ = (id) => document.getElementById(id);
const img = $("shot");
const box = $("selection");

let shot = null; // as stored: { id, blob, name, ... }
let size = { width: 0, height: 0 }; // the image's own pixels
let selection = null; // { x, y, width, height }, in image pixels
const undo = []; // the images before each crop
let objectUrl = null;

// Image pixels per screen pixel: the image is shown shrunk to fit.
const ratio = () => size.width / img.getBoundingClientRect().width;

function show(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = url;
      size = { width: img.naturalWidth, height: img.naturalHeight };
      resolve();
    };
    img.onerror = () => reject(new Error("The screenshot could not be shown."));
    img.src = url;
  });
}

function render() {
  const has = selection !== null;
  box.hidden = !has;
  if (has) {
    const r = ratio();
    box.style.left = `${selection.x / r}px`;
    box.style.top = `${selection.y / r}px`;
    box.style.width = `${selection.width / r}px`;
    box.style.height = `${selection.height / r}px`;
  }
  $("crop").disabled = $("clear").disabled = !has;
  $("undo").disabled = undo.length === 0;
  $("save").textContent = has ? "Save selection" : "Save";
  $("copy").textContent = has ? "Copy selection" : "Copy";
  $("info").textContent = `${size.width} × ${size.height} px`
    + (has ? `; selection ${selection.width} × ${selection.height} px` : "")
    + ". Drag on the image to select part of it.";
}

// A click, or a drag of a pixel or two, selects nothing.
const big = (rect) => rect && rect.width >= 3 && rect.height >= 3;

function setSelection(rect) {
  selection = big(rect) ? rect : null;
  render();
}

// The point under the pointer, in image pixels.
function point(event) {
  const bounds = img.getBoundingClientRect();
  const r = ratio();
  return { x: (event.clientX - bounds.left) * r, y: (event.clientY - bounds.top) * r };
}

let drag = null;

$("stage").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !shot) return;
  event.preventDefault();
  $("stage").setPointerCapture(event.pointerId);
  const start = point(event);
  if (event.target === box && selection) {
    drag = { move: true, start, from: selection };
  } else {
    // A click outside the selection clears it.
    drag = { move: false, start };
    setSelection(null);
  }
});

$("stage").addEventListener("pointermove", (event) => {
  if (!drag) return;
  const now = point(event);
  setSelection(drag.move
    ? moveRect(drag.from, now.x - drag.start.x, now.y - drag.start.y, size.width, size.height)
    : rectBetween(drag.start, now, size.width, size.height));
});

const endDrag = () => {
  drag = null;
};
$("stage").addEventListener("pointerup", endDrag);
$("stage").addEventListener("pointercancel", endDrag);

// The selection as a PNG, or the whole image when nothing is selected.
async function output() {
  if (!selection) return shot.blob;
  const canvas = new OffscreenCanvas(selection.width, selection.height);
  canvas.getContext("2d").drawImage(img,
    selection.x, selection.y, selection.width, selection.height,
    0, 0, selection.width, selection.height);
  return canvas.convertToBlob({ type: "image/png" });
}

function report(text, isError = false) {
  $("error").textContent = isError ? text : "";
  if (!isError) $("info").textContent = text;
}

async function save() {
  const blob = await output();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = selection ? shot.name.replace(/\.png$/, "-part.png") : shot.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

async function copy() {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": output() })]);
    report(selection ? "Copied the selection." : "Copied the image.");
  } catch (error) {
    report(`Could not copy: ${error.message}`, true);
  }
}

// Shows `blob` as the image, and keeps it, so that a reload shows it too.
async function replace(blob) {
  shot.blob = blob;
  drag = null;
  selection = null;
  await show(blob);
  render();
  await putShot(shot);
}

async function crop() {
  if (!selection) return;
  const blob = await output();
  undo.push(shot.blob);
  await replace(blob);
}

async function undoCrop() {
  if (undo.length) await replace(undo.pop());
}

$("save").addEventListener("click", () => save());
$("copy").addEventListener("click", () => copy());
$("crop").addEventListener("click", () => crop());
$("clear").addEventListener("click", () => setSelection(null));
$("undo").addEventListener("click", () => undoCrop());
window.addEventListener("resize", render);

document.addEventListener("keydown", (event) => {
  if (!shot) return;
  const mod = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
  const key = event.key.toLowerCase();
  if (key === "escape") {
    drag = null;
    setSelection(null);
  } else if (mod && key === "s") save();
  else if (mod && key === "c") copy();
  else if (mod && key === "z") undoCrop();
  else return;
  event.preventDefault();
});

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  const stored = id && (await getShot(id));
  if (!stored) {
    report("This screenshot is no longer kept. Take a new one from the extension's icon.", true);
    for (const b of document.querySelectorAll("button")) b.disabled = true;
    return;
  }
  shot = stored;
  // The worker notes the editor's tab just after opening it, and this
  // page may have read the shot before that; a crop must keep it.
  shot.editorTabId = (await chrome.tabs.getCurrent())?.id ?? shot.editorTabId;
  document.title = `${stored.name} — filmil's screenshot`;
  if (stored.scaled < 1) {
    $("note").textContent = "The page was too large for one image at full size, so it was "
      + `made smaller, to ${Math.round(stored.scaled * 100)}% of its size.`;
  }
  await show(shot.blob);
  render();
}

init().catch((error) => report(error.message, true));

// For the end-to-end test.
globalThis.screenshotEditor = {
  size: () => size,
  selection: () => selection,
  output,
};
