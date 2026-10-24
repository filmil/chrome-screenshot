// SPDX-License-Identifier: Apache-2.0
// usage: node set_version.mjs IN OUT VERSION
// Writes the manifest IN to OUT with its version set to VERSION.
import { readFileSync, writeFileSync } from "node:fs";

const [input, output, version] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(input, "utf8"));
manifest.version = version;
writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
