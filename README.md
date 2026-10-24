[![test](https://github.com/filmil/chrome-screenshot/actions/workflows/test.yml/badge.svg)](https://github.com/filmil/chrome-screenshot/actions/workflows/test.yml)
[![release](https://github.com/filmil/chrome-screenshot/actions/workflows/release.yml/badge.svg)](https://github.com/filmil/chrome-screenshot/actions/workflows/release.yml)

# filmil's screenshot

A Chrome extension that takes a screenshot of a tab: of what the tab
shows, or of the whole page, top to bottom. The screenshot opens in a
new tab, where you can select part of it, crop it, and save or copy it.
It shows no ads, tracks nothing, and sends nothing anywhere. The name
says who made it: it is filmil's, from this repository, and not one of
the many screenshot extensions with a generic name.

Screenshot extensions often ask to "read and change all your data on all
websites", and keep that access all the time. This one sees a tab only
when you ask it for a screenshot of that tab.

## What it can and cannot do

- **Permissions: `activeTab` and `scripting`, nothing else.** `activeTab`
  gives the extension the current tab when you click its icon or press
  one of its shortcuts, and only until that tab goes to another page.
  `scripting` lets it scroll that tab, for a screenshot of the whole page.
  It has no host permissions and no content scripts, so it cannot see
  any other tab, or any page you have not asked it to capture. Chrome
  shows no permission warning when you install it.
- **No network.** It makes no requests and loads no remote code. A test
  fails if any of its files names `fetch`, `XMLHttpRequest`, `WebSocket`,
  `eval`, or a URL, or if the manifest asks for more.
- **Keeps nothing.** A screenshot stays in the browser, in the
  extension's own storage, while its tab is open, so that reloading the
  tab keeps it, cropped as you left it. Closing the tab deletes it. Saving and copying are up to
  you.
- **Small.** About 750 lines of JavaScript, HTML and CSS in
  [`extension/`](extension/), with no dependencies and no build step: the
  release zip is that folder, with the version filled in.

## Use

Click the extension's icon and choose:

- **What is on screen**: the part of the page the tab shows.
- **The whole page**: the extension scrolls through the page a screen at
  a time, captures each screen, and joins them into one image. The icon
  shows how far it has got. The page goes back to where it was scrolled
  when it is done. Headers and footers that stay fixed on the screen
  show once, not on every screen: a header at the top of the image, and
  a footer at the bottom.

The screenshot opens in a new tab. **Drag** on it to select part of it;
drag the selection to move it, and press **Esc** to clear it.

- **Save** (Ctrl+S) saves the selection, or the whole image when nothing
  is selected, as a PNG file in your downloads folder.
- **Copy** (Ctrl+C) puts it on the clipboard.
- **Crop to selection** keeps only the selection, and **Undo crop**
  (Ctrl+Z) takes that back.

To take a screenshot from the keyboard, set the shortcuts at
`chrome://extensions/shortcuts`. They have no keys until you choose
some. If a shortcut cannot take a screenshot, the icon shows a red
**!**, and the reason when you point at it.

Limits:

- Chrome lets no extension capture some pages: `chrome://` pages, the
  Chrome Web Store, and other extensions' pages.
- A whole-page screenshot takes about half a second per screen: Chrome
  allows an extension two captures a second. Keep the tab in front until
  it is done; switching tabs stops it.
- A page taller than Chrome can draw in one image (32767 pixels, about
  16000 screen pixels on a high-resolution display) is made smaller to
  fit, and the editor says so.
- Pages that scroll inside a box of their own, as some web apps do,
  rather than as a whole, come out as one screen.

## Install

From a [release](https://github.com/filmil/chrome-screenshot/releases):
download `screenshot-<version>.zip`, check it against the `.sha256` file
beside it, and unzip it. In Chrome, open `chrome://extensions`, turn on
**Developer mode**, choose **Load unpacked**, and pick the unzipped
folder.

Or from source: clone this repository and load its `extension/` folder
the same way.

Chrome 120 or later.

## Releases

[`release.yml`](.github/workflows/release.yml) runs every day. If
`extension/` changed since the last release, it runs the tests, builds
the zip with Bazel, tests that zip in Chrome, and publishes a release
named after the date (for example `v2026.10.24`). It can also be run by
hand from the Actions tab, with **force** to release without changes.

## Chrome Web Store

[`webstore.yml`](.github/workflows/webstore.yml) sends the newest release
to the Chrome Web Store and submits it for review, if the store does not
have that version yet. It runs after each release and once a day. While
a version is in review it sends nothing, and it never sends a rejected
version again; the next release goes instead. It logs in to Google
without a stored key: GitHub Actions proves which repository it runs for,
and Google lets only this repository act as the store's service account.

Until the setup below is done, the workflow skips. The setup is one time:

1. **Register** as a Chrome Web Store developer, with 2-step verification
   on the Google account.
2. **Upload the first version by hand.** In the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole),
   add a new item with the zip from the newest release. Fill in the
   **Store listing** and **Privacy** tabs, and submit it. The privacy
   tab asks for these:
   - Single purpose: take a screenshot of the current tab, and let the
     user crop, save or copy it.
   - `activeTab`: captures the tab the user asked for a screenshot of.
   - `scripting`: scrolls that tab, for a screenshot of the whole page.
   - Remote code: none. Data collected: none.
3. **Create the Google login** for the workflow:
   `scripts/webstore-setup.sh PROJECT_ID filmil/chrome-screenshot`.
   One Google Cloud project serves all your extensions, so if it already
   serves another one, run it with the same project ID; it adds this
   repository. It lets GitHub Actions log in as the store's service
   account from the `webstore.yml` workflow on the main branch of the
   repositories you name, and from nothing else. It prints the next
   steps.
4. **Add the service account** in the Dashboard, under **Account**, if it
   is not there yet.
5. **Set the repository variables** it prints: the provider, the service
   account, the publisher ID (Dashboard, **Publisher**, **Settings**) and
   the item ID.

From then on, each new release goes to the store by itself.

## Development

[Bazel](https://bazel.build) builds the release zip and runs the unit
tests. Use [Bazelisk](https://github.com/bazelbuild/bazelisk), which runs
the version in `.bazelversion`. Bazel downloads Node by itself, so the
machine needs no Node for these.

```sh
bazel test //...                          # unit tests, and the permission and network checks
bazel build //:zip --//:version=1.2.3     # bazel-bin/screenshot-1.2.3.zip
```

The same source and version build the same zip, byte for byte. The
version is 1 to 4 integers, each 0 to 65535 with no leading zeros, as
Chrome requires. Left out, it is the source manifest's version.

The end-to-end test needs Node 22 and npm, since Puppeteer downloads its
own Chrome:

```sh
npm ci
npm run test:e2e    # loads the extension into Chrome for Testing; ~10 s
```

It clicks the extension's icon on a local test page, as a user would,
takes both kinds of screenshot, and checks their size and the colors at
known places, including where fixed headers, fixed footers and sticky
bars end up; then it selects, crops, reloads and undoes in the editor. On Ubuntu
23.10 and later, Chrome's sandbox cannot start without user namespaces;
run it with `E2E_NO_SANDBOX=1`, or allow them with
`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. It loads
`extension/` unless `E2E_EXTENSION_DIR` names another folder; the release
points it at the unzipped zip.

The icons are drawn by [`scripts/make_icons.py`](scripts/make_icons.py)
(`npm run icons`), and CI checks that the committed PNGs match it.

## License

Apache 2.0; see [LICENSE](LICENSE).
