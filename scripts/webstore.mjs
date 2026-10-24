// SPDX-License-Identifier: Apache-2.0
// Sends a release to the Chrome Web Store, if the store does not have it
// yet, and submits it for review.
//
// usage: node scripts/webstore.mjs VERSION ZIP
// env:   CWS_PUBLISHER_ID, CWS_EXTENSION_ID, CWS_ACCESS_TOKEN
//
// It uses version 2 of the Chrome Web Store API:
// https://developer.chrome.com/docs/webstore/using-api
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Compares two versions of 1 to 4 integers, as Chrome does: missing parts
// count as 0. Returns a negative number, 0 or a positive number.
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Chrome's rule for a version: 1 to 4 integers, each 0 to 65535, with no
// leading zeros.
export function isVersion(v) {
  return typeof v === "string" && /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(v)
    && v.split(".").every((p) => Number(p) <= 65535);
}

// The versions the store holds for the item: published, and submitted in
// any state but cancelled. A rejected version is not sent again; the next
// release is. A cancelled one can be sent again.
function storeVersions(status) {
  const submitted = status.submittedItemRevisionStatus;
  return [status.publishedItemRevisionStatus, submitted?.state === "CANCELLED" ? null : submitted]
    .flatMap((revision) => revision?.distributionChannels ?? [])
    .map((channel) => channel.crxVersion)
    .filter(isVersion);
}

// Decides what to do with release `version`, from the store's fetchStatus
// answer. Returns { upload: true } or { upload: false, reason }.
export function plan(status, version) {
  if (status.takenDown) {
    throw new Error("the store has taken the item down; see the Developer Dashboard");
  }
  if (!isVersion(version)) throw new Error(`not a Chrome version: ${version}`);
  // A version in review, or reviewed and waiting for someone to publish it
  // in the Dashboard, is still on its way; a new one would replace it.
  const waiting = { PENDING_REVIEW: "is still in review", STAGED: "is staged, waiting to be published in the Dashboard" };
  const state = status.submittedItemRevisionStatus?.state;
  if (waiting[state]) {
    const [v] = storeVersions({ submittedItemRevisionStatus: status.submittedItemRevisionStatus });
    return { upload: false, reason: `version ${v ?? "?"} ${waiting[state]}` };
  }
  const newest = storeVersions(status).sort(compareVersions).at(-1);
  if (newest && compareVersions(version, newest) <= 0) {
    return { upload: false, reason: `the store already has version ${newest}` };
  }
  return { upload: true };
}

// CWS_API_URL is for tests, which answer in place of the store.
const API = process.env.CWS_API_URL ?? "https://chromewebstore.googleapis.com";

async function call(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    body,
    headers: { Authorization: `Bearer ${process.env.CWS_ACCESS_TOKEN}`, ...headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function main([version, zip]) {
  const publisher = process.env.CWS_PUBLISHER_ID;
  const extension = process.env.CWS_EXTENSION_ID;
  if (!version || !zip || !publisher || !extension || !process.env.CWS_ACCESS_TOKEN) {
    throw new Error("usage: webstore.mjs VERSION ZIP, with CWS_PUBLISHER_ID, CWS_EXTENSION_ID and CWS_ACCESS_TOKEN set");
  }
  const item = `publishers/${publisher}/items/${extension}`;
  const fetchStatus = () => call("GET", `${API}/v2/${item}:fetchStatus`);

  const decision = plan(await fetchStatus(), version);
  if (!decision.upload) {
    console.log(`not sending ${version}: ${decision.reason}`);
    return;
  }

  console.log(`uploading ${zip} (version ${version})`);
  let answer = await call("POST", `${API}/upload/v2/${item}:upload`, readFileSync(zip),
    { "Content-Type": "application/zip" });
  let state = answer.uploadState;
  // A large package is processed after the request returns. CWS_POLL_MS
  // is for tests.
  const pollMs = Number(process.env.CWS_POLL_MS ?? 10_000);
  for (let i = 0; state === "IN_PROGRESS" && i < 30; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    answer = await fetchStatus();
    state = answer.lastAsyncUploadState;
  }
  if (state !== "SUCCEEDED") throw new Error(`upload ended as ${state}: ${JSON.stringify(answer)}`);

  const published = await call("POST", `${API}/v2/${item}:publish`,
    JSON.stringify({ publishType: "DEFAULT_PUBLISH" }), { "Content-Type": "application/json" });
  for (const w of published.warningInfo?.warnings ?? []) console.log(`warning: ${JSON.stringify(w)}`);
  const accepted = ["PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS"];
  if (!accepted.includes(published.state)) {
    throw new Error(`publish ended as ${published.state}: ${JSON.stringify(published)}`);
  }
  console.log(`version ${version} submitted: ${published.state}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(String(error.message ?? error));
    process.exit(1);
  });
}
