// SPDX-License-Identifier: Apache-2.0
// Loads the extension into a real Chrome (Chrome for Testing, from
// Puppeteer), clicks its icon on a local test page, takes screenshots, and
// checks their pixels. Clicking the icon is what gives the extension the
// tab, so the test goes through the popup as a user does.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

// The source folder, or E2E_EXTENSION_DIR: the release sets it to its
// unzipped zip, so the test runs what it publishes.
const extensionDir = process.env.E2E_EXTENSION_DIR
  ? resolve(process.env.E2E_EXTENSION_DIR)
  : fileURLToPath(new URL("../extension", import.meta.url));

// The test page: a fixed red header over six bands of 700 pixels, each
// its own color.
const HEADER = [255, 0, 0];
const BANDS = [[0, 0, 255], [0, 160, 0], [255, 200, 0], [128, 0, 128], [0, 200, 200], [90, 90, 90]];
const BAND = 700;
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const TALL = `<!doctype html><title>tall</title>
<style>body{margin:0} div{height:${BAND}px}
header{position:fixed;top:0;left:0;right:0;height:40px;background:${hex(HEADER)}}</style>
<header></header>${BANDS.map((c) => `<div style="background:${hex(c)}"></div>`).join("")}`;

let browser, server, extension, base;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(TALL);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: true,
    defaultViewport: { width: 800, height: 600, deviceScaleFactor: 1 },
    // Only for hosts where Chrome's sandbox cannot start (Ubuntu 23.10+
    // restricts the user namespaces it needs). The test page is local.
    args: process.env.E2E_NO_SANDBOX ? ["--no-sandbox"] : [],
  });
  const id = await browser.installExtension(extensionDir);
  extension = (await browser.extensions()).get(id);
  assert.equal(extension?.name, "filmil's screenshot");
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function tallPage() {
  const page = await browser.newPage();
  await page.goto(`${base}/tall`);
  return page;
}

// Clicks the extension's icon on `page`, and opens the popup.
async function openPopup(page) {
  await page.bringToFront();
  const opened = browser.waitForTarget((t) => t.url().endsWith("/popup.html"));
  await page.triggerExtensionAction(extension);
  return (await opened).asPage();
}

// Takes a screenshot of `page` from the popup, and returns the editor.
async function shoot(page, mode) {
  const popup = await openPopup(page);
  const seen = new Set((await browser.pages()).map((p) => p.target()));
  const editorOpened = browser.waitForTarget(
    (t) => t.url().includes("/editor.html?id=") && !seen.has(t), { timeout: 60_000 });
  await popup.click(mode === "page" ? "#page" : "#visible");
  // Fails at once on an error in the popup, instead of waiting.
  const failed = popup.waitForFunction(() => document.getElementById("error").textContent, { timeout: 0 })
    .then(async (h) => { throw new Error(`the popup says: ${await h.jsonValue()}`); }, () => {});
  const editor = await (await Promise.race([editorOpened, failed])).asPage();
  await editor.waitForFunction(() => globalThis.screenshotEditor?.size().width > 0);
  return editor;
}

// The editor's image (or selection): its size, and the colors at `points`.
function sample(editor, points) {
  return editor.evaluate(async (points) => {
    const bitmap = await createImageBitmap(await globalThis.screenshotEditor.output());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const colors = points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]);
    return { width: bitmap.width, height: bitmap.height, colors };
  }, points);
}

function assertColor(actual, want, where) {
  assert.ok(actual.every((v, i) => Math.abs(v - want[i]) <= 3),
    `${where}: got ${actual}, want ${want}`);
}

test("a screenshot of what is on screen", { timeout: 60_000 }, async () => {
  const page = await tallPage();
  const editor = await shoot(page, "visible");
  const view = await page.evaluate(() => [innerWidth, innerHeight]);
  const shot = await sample(editor, [[10, 10], [10, 300], [10, 590]]);
  assert.deepEqual([shot.width, shot.height], view);
  assertColor(shot.colors[0], HEADER, "header");
  assertColor(shot.colors[1], BANDS[0], "first band");
  assertColor(shot.colors[2], BANDS[0], "first band, bottom");
  await editor.close();
  await page.close();
});

test("a screenshot of the whole page", { timeout: 60_000 }, async () => {
  const page = await tallPage();
  await page.evaluate(() => window.scrollTo(0, 1000));
  const editor = await shoot(page, "page");
  const size = await page.evaluate(() =>
    [document.documentElement.clientWidth, document.documentElement.scrollHeight]);
  assert.equal(size[1], BAND * BANDS.length);
  const points = [[10, 10], [10, 620], [10, 1250]];
  for (let i = 0; i < BANDS.length; i++) points.push([400, i * BAND + BAND / 2]);
  points.push([400, BAND * BANDS.length - 2]);
  const shot = await sample(editor, points);
  assert.deepEqual([shot.width, shot.height], size);
  assertColor(shot.colors[0], HEADER, "the header, at the top");
  // The header is fixed, so each screen would show it; it shows only once.
  assertColor(shot.colors[1], BANDS[0], "under the second screen's header");
  assertColor(shot.colors[2], BANDS[1], "under the third screen's header");
  for (let i = 0; i < BANDS.length; i++) assertColor(shot.colors[3 + i], BANDS[i], `band ${i}`);
  assertColor(shot.colors.at(-1), BANDS.at(-1), "the bottom edge");
  // The page is as it was.
  assert.equal(await page.evaluate(() => window.scrollY), 1000);
  // Chrome may leave an empty style="" where there was none.
  assert.deepEqual(await page.evaluate(() =>
    [document.documentElement, document.querySelector("header")]
      .map((e) => e.getAttribute("style") ?? "")), ["", ""]);
  assert.equal(await page.$eval("header", (h) => getComputedStyle(h).visibility), "visible");
  await editor.close();
  await page.close();
});

test("select, crop, and undo in the editor", { timeout: 60_000 }, async () => {
  const page = await tallPage();
  const editor = await shoot(page, "visible");
  await editor.setViewport({ width: 1000, height: 800 });
  const img = await editor.$("#shot");
  const box = await img.boundingBox();
  const full = await editor.evaluate(() => globalThis.screenshotEditor.size());
  const ratio = full.width / box.width;
  // Drag from 100,20 to 300,120 in the image's own pixels.
  const at = (x, y) => [box.x + x / ratio, box.y + y / ratio];
  await editor.mouse.move(...at(100, 20));
  await editor.mouse.down();
  await editor.mouse.move(...at(200, 70), { steps: 5 });
  await editor.mouse.move(...at(300, 120), { steps: 5 });
  await editor.mouse.up();
  const selection = await editor.evaluate(() => globalThis.screenshotEditor.selection());
  for (const [key, want] of Object.entries({ x: 100, y: 20, width: 200, height: 100 })) {
    assert.ok(Math.abs(selection[key] - want) <= 2, `${key}: ${selection[key]}`);
  }
  assert.match(await editor.$eval("#save", (b) => b.textContent), /selection/);
  // The selection covers the header's lower edge: red above y=40.
  const part = await sample(editor, [[5, 5], [5, selection.height - 5]]);
  assert.deepEqual([part.width, part.height], [selection.width, selection.height]);
  assertColor(part.colors[0], HEADER, "the selection's top");
  assertColor(part.colors[1], BANDS[0], "the selection's bottom");

  await editor.click("#crop");
  await editor.waitForFunction((w) => globalThis.screenshotEditor.size().width === w, {},
    selection.width);
  assert.equal(await editor.evaluate(() => globalThis.screenshotEditor.selection()), null);
  await editor.click("#undo");
  await editor.waitForFunction((w) => globalThis.screenshotEditor.size().width === w, {},
    full.width);
  await editor.keyboard.press("Escape");
  await editor.close();
  await page.close();
});

test("closing the editor forgets the screenshot", { timeout: 60_000 }, async () => {
  const page = await tallPage();
  const editor = await shoot(page, "visible");
  const url = editor.url();
  await editor.close();
  const again = await browser.newPage();
  // The worker deletes it when it hears that the tab closed.
  const deadline = Date.now() + 5_000;
  let gone = false;
  while (!gone && Date.now() < deadline) {
    await again.goto(url);
    gone = (await again.$eval("#error", (e) => e.textContent)) !== "";
    if (!gone) await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(gone, "the screenshot is still kept");
  await again.close();
  await page.close();
});

test("a page Chrome protects gives a clear error", { timeout: 60_000 }, async () => {
  const page = await browser.newPage();
  await page.goto("chrome://version");
  const popup = await openPopup(page);
  await popup.click("#page");
  await popup.waitForFunction(() => document.getElementById("error").textContent !== "");
  assert.match(await popup.$eval("#error", (e) => e.textContent), /does not let extensions/);
  await popup.close();
  await page.close();
});
