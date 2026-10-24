// SPDX-License-Identifier: Apache-2.0
// The manifest Bazel puts in the zip is the source one, with only the
// version set. Built with the default version, which is the source
// manifest's, the two are the same.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

test("the built manifest is the source manifest", () => {
  assert.deepEqual(read("manifest/manifest.json"), read("extension/manifest.json"));
});
