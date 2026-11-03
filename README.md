# FileTree

A file tree for BB's right panel.

<img src="docs/screenshots/files.png" alt="The Files tab: a searchable tree of workspace files with Symbols file icons" width="300">

- Browse workspaces and project sources with search, Git status and live updates.
- Pick a file to open it in BB's own viewer, as a tab in the right panel.
- With the right panel split, files open in the other pane, so the tree stays in view.
- A fixed **Files** tab in every thread's right panel.

File access is read-only.

```sh
bb plugin install https://github.com/wy3z/bb-plugin-filetree
```

Requires BB 0.48.1+. Includes a Linux x64 build; macOS requires a native build. Windows is unsupported.

[Development and CLI](docs/development.md)

File icons are [Symbols](https://github.com/miguelsolorio/vscode-symbols) by Miguel Solorio (MIT), as bundled by Zeron, with slate greys made neutral; see `vendor/symbols`.
