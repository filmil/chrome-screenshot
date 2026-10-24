// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_AREA, MAX_SIDE, dataUrlToBlob, explainError, fileName, fitScale,
  moveRect, planTiles, progressText, rectBetween,
} from "../extension/lib.js";

test("a page that fits the viewport is one tile", () => {
  assert.deepEqual(planTiles(800, 600, 800, 600), [{ x: 0, y: 0 }]);
  assert.deepEqual(planTiles(500, 300, 800, 600), [{ x: 0, y: 0 }]);
});

test("tiles go down the page, the last one ending at its bottom", () => {
  assert.deepEqual(planTiles(800, 1500, 800, 600),
    [{ x: 0, y: 0 }, { x: 0, y: 600 }, { x: 0, y: 900 }]);
  assert.deepEqual(planTiles(800, 1800, 800, 600),
    [{ x: 0, y: 0 }, { x: 0, y: 600 }, { x: 0, y: 1200 }]);
});

test("a wide page is covered row by row", () => {
  assert.deepEqual(planTiles(1000, 1000, 800, 600), [
    { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 400 }, { x: 200, y: 400 },
  ]);
});

test("every point of the page is in some tile", () => {
  for (const [pw, ph, vw, vh] of [[1280, 9999, 1265, 657], [3000, 2000, 777, 333]]) {
    const tiles = planTiles(pw, ph, vw, vh);
    for (let y = 0; y < ph; y += 37) {
      for (let x = 0; x < pw; x += 41) {
        assert.ok(tiles.some((t) => x >= t.x && x < t.x + vw && y >= t.y && y < t.y + vh),
          `${x},${y} of ${pw}x${ph}`);
      }
    }
  }
});

test("an empty viewport is refused", () => {
  assert.throws(() => planTiles(800, 600, 0, 600));
});

test("images within Chrome's limits keep their size", () => {
  assert.equal(fitScale(1920, 10000), 1);
  assert.equal(fitScale(MAX_SIDE, 100), 1);
});

test("larger images shrink to fit every limit", () => {
  for (const [w, h] of [[2560, 100000], [40000, 100], [8000, 30000], [3840, 32768]]) {
    const f = fitScale(w, h);
    assert.ok(f < 1, `${w}x${h}`);
    const sw = Math.round(w * f);
    const sh = Math.round(h * f);
    assert.ok(sw <= MAX_SIDE && sh <= MAX_SIDE && sw * sh <= MAX_AREA, `${w}x${h} to ${sw}x${sh}`);
  }
});

test("a selection is the same whichever way it is dragged", () => {
  const want = { x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(rectBetween({ x: 10, y: 20 }, { x: 40, y: 60 }, 100, 100), want);
  assert.deepEqual(rectBetween({ x: 40, y: 60 }, { x: 10, y: 20 }, 100, 100), want);
  assert.deepEqual(rectBetween({ x: 40, y: 20 }, { x: 10, y: 60 }, 100, 100), want);
});

test("a selection stays inside the image, in whole pixels", () => {
  assert.deepEqual(rectBetween({ x: -5, y: 10.4 }, { x: 150, y: 20.6 }, 100, 50),
    { x: 0, y: 10, width: 100, height: 11 });
});

test("a moved selection stops at the image's edges", () => {
  const r = { x: 10, y: 10, width: 20, height: 20 };
  assert.deepEqual(moveRect(r, 5, -3, 100, 100), { x: 15, y: 7, width: 20, height: 20 });
  assert.deepEqual(moveRect(r, -50, 500, 100, 100), { x: 0, y: 80, width: 20, height: 20 });
});

test("file names carry the host and the local time", () => {
  const d = new Date(2026, 9, 4, 5, 6, 7);
  assert.equal(fileName(d, "https://www.example.com/a?b"), "screenshot-www.example.com-2026-10-04-050607.png");
  assert.equal(fileName(d, undefined), "screenshot-2026-10-04-050607.png");
  assert.equal(fileName(d, "about:blank"), "screenshot-2026-10-04-050607.png");
  assert.equal(fileName(d, "file:///home/x.html"), "screenshot-2026-10-04-050607.png");
});

test("progress is in whole percent", () => {
  assert.equal(progressText(0, 3), "0%");
  assert.equal(progressText(2, 3), "66%");
  assert.equal(progressText(0, 0), "0%");
});

test("data: URLs become blobs", async () => {
  const blob = dataUrlToBlob("data:image/png;base64,iVBORw0K");
  assert.equal(blob.type, "image/png");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  assert.throws(() => dataUrlToBlob("data:text/plain,hi"));
});

test("errors on pages Chrome protects are explained", () => {
  assert.match(explainError(new Error("Cannot access contents of url \"chrome://version/\".")),
    /does not let extensions capture this page/);
  assert.match(explainError(new Error("The extensions gallery cannot be scripted.")),
    /does not let extensions/);
  assert.equal(explainError(new Error("something else")), "something else");
});
