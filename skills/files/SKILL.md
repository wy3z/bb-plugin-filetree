---
name: files
description: Browse a thread's workspace or project sources, search paths, inspect Git status, read text, or prepare a file download with the FileTree plugin.
---

# FileTree

Use `bb files roots` first when selecting a project source. Commands default to the current thread and its active workspace; pass `--thread ID` or `--root ID` explicitly to choose another scope.

```sh
bb files roots
bb files list src
bb files search "preview worker"
bb files git
bb files read README.md
bb files download slides.pptx
```

Quote paths and queries containing spaces. Paths are normalized root-relative paths; absolute paths and traversal are rejected. Commands return JSON, and failures exit nonzero with an explanation.

`read` returns UTF-8 text up to 128 KiB. `download` prepares a verified snapshot up to 25 MiB and returns a server-relative URL valid for five minutes. Use the connected BB server's authenticated origin to fetch it. Do not post or log download URLs externally.

These operations do not modify workspace files. The UI opens from a thread's right-panel launcher and supports previews, word wrap, manual refresh, opening live files in BB’s preferred editor, copied paths/text, and downloads. File attachments are unavailable. The CLI read/list/search/git commands always retrieve fresh data; preview wrapping is a UI presentation setting.

If a root becomes stale, list roots again. If the host reports a missing native addon, the plugin needs a build for that host's operating system and architecture; do not replace descriptor confinement with pathname checks.
