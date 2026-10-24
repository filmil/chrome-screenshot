// SPDX-License-Identifier: Apache-2.0
// Takes a screenshot of the current tab, and opens it in the editor.
//
// The extension can see a tab only after the user clicks its icon, or
// presses one of its shortcuts, on that tab: that is what the "activeTab"
// permission gives, until the tab goes to another page. "scripting" lets
// it scroll that tab, for a screenshot of the whole page.
import {
  CAPTURE_INTERVAL_MS, dataUrlToBlob, explainError, fileName, fitScale,
  planTiles, progressText,
} from "./lib.js";
import { deleteShot, listShots, putShot } from "./store.js";

let busy = false;
let lastCapture = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Captures what tab `tab` shows, no sooner than Chrome allows after the
// last capture, of this screenshot or of the one before. The wait also
// gives the page a moment to draw what scrolled into view.
async function captureTab(tab) {
  await sleep(Math.max(0, lastCapture + CAPTURE_INTERVAL_MS - Date.now()));
  // Chrome captures whatever tab the window shows.
  if (!(await chrome.tabs.get(tab.id)).active) {
    throw new Error("The tab was switched away from, so the screenshot was stopped.");
  }
  lastCapture = Date.now();
  const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return dataUrlToBlob(url);
}

// Takes away the progress, or an error that a shortcut left, from the icon.
async function clearIcon(tabId) {
  await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  await chrome.action.setTitle({ tabId, title: "" }).catch(() => {});
}

// Takes a screenshot of tab `tabId`: of what it shows ("visible"), or of
// the whole page ("page"). Opens the editor with it.
async function capture(tabId, mode) {
  if (busy) throw new Error("A screenshot is already being taken.");
  busy = true;
  try {
    await clearIcon(tabId);
    await prune();
    const tab = await chrome.tabs.get(tabId);
    const shot = mode === "page" ? await capturePage(tab) : await captureVisible(tab);
    shot.id = crypto.randomUUID();
    shot.created = Date.now();
    shot.name = fileName(new Date(shot.created), tab.url);
    await putShot(shot);
    const editor = await chrome.tabs.create({
      url: `editor.html?id=${shot.id}`,
      index: tab.index + 1,
      openerTabId: tab.id,
    });
    await putShot({ ...shot, editorTabId: editor.id });
    return { id: shot.id };
  } catch (error) {
    throw new Error(explainError(error));
  } finally {
    busy = false;
    await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
}

async function captureVisible(tab) {
  return { blob: await captureTab(tab), scaled: 1 };
}

// Scrolls through the page a screen at a time, captures each screen, and
// draws them into one image.
async function capturePage(tab) {
  const tabId = tab.id;
  const page = await inTab(tabId, preparePage);
  try {
    const tiles = planTiles(page.width, page.height, page.viewWidth, page.viewHeight);
    let canvas = null;
    let context = null;
    let scale = 1; // image pixels per CSS pixel
    for (const [i, tile] of tiles.entries()) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#1a73e8" });
      await chrome.action.setBadgeText({ tabId, text: progressText(i, tiles.length) });
      // Fixed headers show in the first row of screens only, and fixed
      // footers in the last.
      const at = await inTab(tabId, scrollPage, tile.x, tile.y,
        tile.y === tiles[0].y, tile.y === tiles.at(-1).y);
      const bitmap = await createImageBitmap(await captureTab(tab));
      if (!canvas) {
        const pixelRatio = bitmap.width / page.innerWidth;
        const fit = fitScale(page.width * pixelRatio, page.height * pixelRatio);
        scale = pixelRatio * fit;
        canvas = new OffscreenCanvas(
          Math.round(page.width * scale), Math.round(page.height * scale));
        context = canvas.getContext("2d");
        context.imageSmoothingQuality = "high";
        page.scaled = fit;
      }
      // The capture's scale, which can differ from `scale` when the image
      // was made smaller to fit.
      const s = bitmap.width / page.innerWidth;
      const dx = Math.round(at.x * scale);
      const dy = Math.round(at.y * scale);
      // Only the page's own area: not the scroll bars.
      context.drawImage(bitmap,
        0, 0, Math.round(page.viewWidth * s), Math.round(page.viewHeight * s),
        dx, dy,
        Math.round((at.x + page.viewWidth) * scale) - dx,
        Math.round((at.y + page.viewHeight) * scale) - dy);
      bitmap.close();
    }
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return { blob, scaled: page.scaled };
  } finally {
    await inTab(tabId, restorePage).catch(() => {});
  }
}

async function inTab(tabId, func, ...args) {
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (!frame || frame.error) throw new Error(frame?.error?.message ?? "the page did not answer");
  return frame.result;
}

// The functions below run in the page, in the extension's isolated world,
// which keeps its globals between calls. They see the page's DOM and
// nothing of this worker.

function preparePage() {
  const root = document.documentElement;
  const state = {
    x: window.scrollX,
    y: window.scrollY,
    styles: new Map(), // element: its style attribute before, to put back
    top: [], // fixed elements in the top half of the screen
    bottom: [], // and in the bottom half
  };
  // In quirks mode the body, not the root, has the viewport's size.
  const viewport = document.compatMode === "BackCompat" && document.body ? document.body : root;
  const set = (element, property, value) => {
    if (!state.styles.has(element)) state.styles.set(element, element.getAttribute("style"));
    element.style.setProperty(property, value, "important");
  };
  state.set = set;
  set(root, "scroll-behavior", "auto");
  for (const element of document.querySelectorAll("body *")) {
    const position = getComputedStyle(element).position;
    // A sticky element would follow each screen down the page; left where
    // the page puts it, it shows once.
    if (position === "sticky") set(element, "position", "static");
    else if (position === "fixed") {
      const box = element.getBoundingClientRect();
      const middle = (box.top + box.bottom) / 2;
      (middle < viewport.clientHeight / 2 ? state.top : state.bottom).push(element);
    }
  }
  globalThis.filmilScreenshot = state;
  const body = document.body;
  return {
    width: Math.max(root.scrollWidth, body?.scrollWidth ?? 0, root.clientWidth),
    height: Math.max(root.scrollHeight, body?.scrollHeight ?? 0, root.clientHeight),
    viewWidth: viewport.clientWidth,
    viewHeight: viewport.clientHeight,
    innerWidth: window.innerWidth,
  };
}

async function scrollPage(x, y, firstRow, lastRow) {
  const state = globalThis.filmilScreenshot;
  // Shown means as the page has it, which may be hidden too.
  const show = (elements, shown) => {
    for (const element of elements) {
      if (!shown) state.set(element, "visibility", "hidden");
      else if (state.styles.has(element)) {
        const style = state.styles.get(element);
        if (style === null) element.removeAttribute("style");
        else element.setAttribute("style", style);
      }
    }
  };
  show(state.top, firstRow);
  show(state.bottom, lastRow);
  window.scrollTo({ left: x, top: y, behavior: "instant" });
  // Two frames: the scroll is drawn by the second.
  const frame = () => new Promise((r) => {
    requestAnimationFrame(r);
    setTimeout(r, 100);
  });
  await frame();
  await frame();
  return { x: window.scrollX, y: window.scrollY };
}

function restorePage() {
  const state = globalThis.filmilScreenshot;
  if (!state) return;
  delete globalThis.filmilScreenshot;
  for (const [element, style] of state.styles) {
    if (style === null) element.removeAttribute("style");
    else element.setAttribute("style", style);
  }
  window.scrollTo({ left: state.x, top: state.y, behavior: "instant" });
}

// Screenshots whose editor tab is gone: closed, or never opened.
async function prune() {
  for (const shot of await listShots()) {
    const open = shot.editorTabId !== undefined
      && (await chrome.tabs.get(shot.editorTabId).then(() => true, () => false));
    if (!open && Date.now() - shot.created > 60_000) await deleteShot(shot.id);
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  for (const shot of await listShots()) {
    if (shot.editorTabId === tabId) await deleteShot(shot.id);
  }
});

chrome.runtime.onStartup.addListener(() => prune());

// A shortcut has no popup to show an error in, so the error goes on the
// icon: a red "!", and the message when the pointer is over it.
chrome.commands.onCommand.addListener(async (command, tab) => {
  const modes = { "capture-visible": "visible", "capture-page": "page" };
  if (!modes[command] || tab?.id === undefined) return;
  const tabId = tab.id;
  // A second press while the first is still at work does nothing.
  if (busy) return;
  try {
    await capture(tabId, modes[command]);
  } catch (error) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#c5221f" }).catch(() => {});
    await chrome.action.setBadgeText({ tabId, text: "!" }).catch(() => {});
    await chrome.action.setTitle({ tabId, title: error.message }).catch(() => {});
  }
});

// Only this extension's own popup can send these.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.type !== "capture") return false;
  capture(message.tabId, message.mode === "page" ? "page" : "visible").then(
    (result) => reply({ ok: true, result }),
    (error) => reply({ ok: false, error: error.message }),
  );
  return true; // reply is sent asynchronously
});
