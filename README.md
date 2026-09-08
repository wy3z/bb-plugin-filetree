# Files

A thread workspace explorer implemented entirely through BB's existing plugin APIs. Once installed, Files handles normal file opens for its supported extensions. You can also open **Files** from a thread's right-panel new-tab launcher.

Files provides a virtualized directory tree, workspace/project-source selection, path search, Git status decorations, live filesystem refresh, keyboard navigation, persistent tree state, and previews for source, Markdown, images, PDF, safe HTML, DOCX, XLSX, and PPTX. The preview toolbar provides word wrap, manual refresh, opening the live file in BB’s preferred editor, and copying text. The file tree context menu can download a verified snapshot. It does not attach files to chat.

## Default file viewer

The plugin registers the existing `app.slots.fileOpener` API for source/text, Markdown, HTML, image, PDF, DOCX, XLSX and PPTX extensions supported by its preview router. Opening a file through BB's search or a workspace link selects that file in its file tab and expands its parent directories, overriding saved selection and search for the initial open. Each tab keeps its own workspace choice while open.

Workspace requests match the exact environment. Absolute host paths select the most specific authorized root on that host. Thread storage, paths outside those roots, missing thread context, unavailable roots, extensionless files, unsupported extensions, and Git snapshots retain BB's original viewer. The SDK does not supply line ranges to file openers, so line-linked opens select the file without jumping to the requested line.

BB's **Settings → Files** per-extension preferences and **Open with** choices take precedence over automatic selection. Choose Files there if another viewer is pinned. This changes no core APIs or global preferences. SDK navigation and `bb thread open THREAD_ID path/to/file.ts` use the same host routing; plugin read/download commands remain unchanged.

## Build and install

Install the prepared Linux x64 plugin with stable BB:

```sh
bb plugin install https://github.com/wy3z/bb-plugin-filetree
```

To develop or rebuild it, use Node.js 22 or newer, pnpm, and the stable BB CLI on PATH:

```sh
git clone https://github.com/wy3z/bb-plugin-filetree.git
cd bb-plugin-filetree
pnpm install --frozen-lockfile
pnpm verify
bb plugin install .
```

The repository now contains **Files** (`bb-plugin-files`, plugin ID `files`), replacing the original File Tree implementation. If `filetree` is already installed, disable it before installing Files to avoid duplicate viewers. The old plugin is a separate identity and is not migrated by `bb plugin update filetree`.

The plugin pins public SDK 0.4.47 and requires BB 0.42 or newer. It does not change BB's core APIs, daemon protocol, or application dependencies. A C compiler, Python and Node headers are required to build the descriptor-based native addon. The generated addon is embedded in the host artifact; the enrolled host does not need a compiler.

This release is verified on Linux x64. macOS requires building and verifying on the target platform. Windows is unsupported. The Linux binary must match the target libc. Unsupported or missing native binaries fail closed.

To prepare an installable package after the build:

```sh
pnpm pack
bb plugin install ./bb-plugin-files-0.2.0.tgz
```

This standalone repository includes the generated worker and native-asset modules needed by BB's Git installer, which skips generation scripts. `pnpm build` regenerates them from source. Commit updated generated assets with source changes before publishing. For multi-platform packages, supply the corresponding `prebuilds/linux-x64.node`, `linux-arm64.node`, `darwin-x64.node`, or `darwin-arm64.node` files before generation.

## CLI

Commands return JSON. `--thread` defaults to the invoking BB thread; `--root` defaults to that thread's active workspace. Root identifiers come from `roots` and become invalid when the source moves or changes hosts.

```sh
bb files roots --thread THREAD_ID
bb files list src --thread THREAD_ID
bb files search "preview worker" --thread THREAD_ID
bb files git --thread THREAD_ID
bb files read README.md --thread THREAD_ID
bb files download slides.pptx --thread THREAD_ID --root ROOT_ID
```

`read` accepts UTF-8 text up to 128 KiB. `download` returns a relative `contentUrl` for the BB server, valid for five minutes; fetch it through the same authenticated BB origin. Files over 25 MiB are rejected. File operations are read-only.

## SDK and RPC

`contracts/rpc.ts` exports the typed plugin contract used by the frontend's `useRpc`. Other SDK consumers can call `sdk.plugins.callRpc` with plugin ID `files` and methods `roots`, `directory`, `search`, `gitStatus`, `transfer`, `cancel`, or `watch`, supplying the corresponding contract schema. `transfer`, `search` and `gitStatus` require an `operationId`; pass the same thread/root/operation identity to `cancel` to abort an in-flight request. `watch` returns the current `rootIds` and whether all native watches were established. The CLI exercises the same service. No `sdk.files.explorer` extension is required.

The server resolves the thread, environment, and project sources through `bb.sdk` before host I/O and checks the root identity again before publishing results. Clients cannot supply a host or absolute root path. Directory listing, search and Git retain descriptor-relative host operations. File reads use the stable `sdk.files.read` API and its path/symlink handling; they no longer use the plugin’s descriptor-relative read implementation. The server checks the returned size and SHA-256, then retains immutable download bytes in a cache bounded to 100 MiB including reservations for in-flight reads. BB limits images to 10 MiB and other files to 25 MiB. Missing modification times are returned as `null`.

The panel renews native watches every 30 seconds. Watches expire 75 seconds after their last renewal; worker disposal closes them. Signals invalidate only their affected root. Reconnects and changes to the watched root inventory reconcile the panel; failed watch setup falls back to periodic refresh. Successful lease renewals do not reload every preview.

## Verification

```sh
pnpm verify
```

Tests cover confinement races, Git helper isolation, stale-root rejection, bounded SDK reads and immutable downloads, previews, cancellation, persistent tree state, and omission of the removed actions. The smoke task loads the built host artifact from a fresh directory, exercises its embedded native addon, rejects a symlink escape, and exercises directory listing and search. Server tests cover immutable 25 MiB downloads, integrity failures, cancellation and capacity recovery.

Controls and the responsive drawer in `vendor/` come from BB’s 0.42.1 registry/shared UI. The split view uses `react-resizable-panels`, with saved widths and a collapsible file tree. The plugin remains independently buildable. It preserves deferred content realization and avoids hiding or making the app root inert.
