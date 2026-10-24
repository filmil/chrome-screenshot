// SPDX-License-Identifier: Apache-2.0
const $ = (id) => document.getElementById(id);

async function take(mode) {
  $("error").textContent = "";
  $("visible").disabled = $("page").disabled = true;
  $("status").textContent = mode === "page"
    ? "Scrolling through the page…" : "Taking the screenshot…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No tab to capture.");
    const reply = await chrome.runtime.sendMessage({ type: "capture", mode, tabId: tab.id });
    if (!reply?.ok) throw new Error(reply?.error ?? "No reply from the extension.");
    window.close();
  } catch (e) {
    $("status").textContent = "";
    $("error").textContent = e.message;
    $("visible").disabled = $("page").disabled = false;
  }
}

$("visible").addEventListener("click", () => take("visible"));
$("page").addEventListener("click", () => take("page"));
