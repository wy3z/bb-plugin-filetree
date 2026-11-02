# FileTree

A Codex-style file tree for BB.

![FileTree pane with a source preview and searchable file tree](docs/screenshots/files.png)

- Browse workspaces and project sources with search, Git status and live updates.
- Pick a file to open it in BB's own viewer, as a tab in the right panel.
- A fixed **Files** tab in every thread's right panel.

File access is read-only.

```sh
bb plugin install https://github.com/wy3z/bb-plugin-filetree
```

Requires BB 0.48+. Includes a Linux x64 build; macOS requires a native build. Windows is unsupported.

[Development and CLI](docs/development.md)

File icons are [Symbols](https://github.com/miguelsolorio/vscode-symbols) by Miguel Solorio (MIT), as bundled by Zeron, with slate greys made neutral; see `vendor/symbols`.
