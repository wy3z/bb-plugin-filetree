# BB File Tree

A read-only file explorer for [BB](https://github.com/get-bb/bb), inspired by the compact file-tree + viewer layout in Codex Desktop.

The plugin adds a **Files** action to a thread's right panel. The tab keeps the file tree and preview together, so selecting another file changes the preview without opening another BB tab.

## Features

- Read-only BB-native source preview with syntax highlighting and line numbers.
- Wrap-lines toggle using BB's source renderer.
- Viewer header actions for refresh, copy contents, and opening the selected file in the preferred external editor.
- Native BB file context menus on file rows, including **Open preview**, **Open with** registered file openers, **Open externally**, **Open in** available client apps, and copy actions.
- Lazy directory expansion instead of eagerly walking the whole repository.
- Dotfiles and `node_modules` are visible; `.git` is intentionally hidden.
- Symlinks are intentionally omitted so the explorer never follows a tree outside the workspace root.
- Bounded global filename/path filtering, with generated dependency/build directories searched after normal source directories.
- Resizable tree with client-local width persistence.
- Remembers the last selected file for each thread.
- Right-click copy actions for directories.
- Works against remote thread environments through a BB host plugin worker.

## Install

```sh
bb plugin install git:https://github.com/wy3z/bb-plugin-filetree.git@main
```

Then open a thread and choose **+ → Files** in the right panel.

Requires BB `>=0.40.0` and Plugin SDK `>=0.4.21`.

## Development

```sh
npm install
npm run typecheck
bb plugin build
```

For local development:

```sh
bb plugin install path:$PWD
bb plugin reload filetree
```

## Current scope

This first version is deliberately a viewer, not an editor. It does not create, rename, delete, or modify files. Binary files are reported as unsupported rather than rendered. Text previews are capped at 4 MiB and global search scans at most 30,000 entries per request.

The longer-term layout could move the same tree into a persistent workspace rail if BB exposes such a plugin surface in future.