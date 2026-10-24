// SPDX-License-Identifier: Apache-2.0
// The extension's promise is how little it can do. These tests fail if a
// change widens that.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("../extension/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));

test("permissions are only activeTab and scripting", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting"]);
  for (const key of ["host_permissions", "optional_permissions",
    "optional_host_permissions", "content_scripts", "externally_connectable",
    "web_accessible_resources"]) {
    assert.equal(manifest[key], undefined, `manifest has ${key}`);
  }
});

test("no code reaches the network or evaluates strings", () => {
  // Every file Chrome could load from the extension, in subfolders too.
  const files = readdirSync(dir, { recursive: true })
    .filter((f) => /\.(m?js|html|css|svg)$/i.test(f))
    .map((f) => [f, readFileSync(new URL(f, dir), "utf8")]);
  assert.ok(files.some(([f]) => /\.js$/.test(f)) && files.some(([f]) => /\.css$/.test(f)));
  for (const [file, text] of files) {
    const bad = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/,
      /sendBeacon/, /\beval\s*\(/, /new Function\b/, /https?:\/\//i, /importScripts/,
      // A protocol-relative address in a string: "//host/x".
      /["'`]\s*\/\/(?![\s/])/];
    // A stylesheet can load a URL with @import or url(...); only data:
    // URLs are allowed.
    if (/\.(css|html|svg)$/i.test(file)) bad.push(/@import/i, /url\s*\((?!\s*["']?\s*data:)/i);
    for (const pattern of bad) assert.doesNotMatch(text, pattern, `${file} matches ${pattern}`);
  }
});

test("the name says whose extension it is", () => {
  const name = "filmil's screenshot";
  assert.equal(manifest.name, name);
  assert.equal(manifest.action.default_title, name);
  const popup = readFileSync(new URL("popup.html", dir), "utf8");
  assert.match(popup, new RegExp(`<title>${name}</title>`));
  assert.match(popup, new RegExp(`<h1>${name}</h1>`));
  assert.ok(manifest.description.length <= 132, "Chrome allows 132 characters");
});

test("each shortcut the worker handles is declared", () => {
  const worker = readFileSync(new URL("background.js", dir), "utf8");
  for (const command of Object.keys(manifest.commands)) {
    assert.match(worker, new RegExp(`"${command}"`), command);
  }
});
