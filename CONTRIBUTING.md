# Contributing

## Prerequisites

- [Zelos](https://zeloscloud.io) 26.0.10 or later
- [Zelos CLI](https://docs.zeloscloud.io/reference/cli/) 0.1.11 or later
- [just](https://github.com/casey/just)
- Node.js 24 LTS (see `web/.nvmrc`)

## Layout

`extension.toml` describes everything the extension contributes. This extension contributes a
tab:

| Part | Files | Manifest |
| ---- | ----- | -------- |
| Tab | `web/src/tab/` | `[app] tab` |

The web project builds the tab document into `dist/` at the project root with `just build`
(`npm run build`). `.gitignore` keeps `dist/` out of the repository, so a fresh clone has none
until its first build.

| Path | Contents |
| ---- | -------- |
| `web/src/tab/` | The tab document, its entry point and `App` |
| `web/src/components/` | The agent cards, the add and edit dialog, and the shadcn/ui components |
| `web/src/hooks/` | Discovery, bus snapshot and transmit row hooks |
| `web/src/lib/` | The CAN action calls, their wire types, discovery and the transmit row store |
| `web/src/mocks/` | The mock CAN extension that `just dev` runs against |

## Commands

| Command                | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `just install`         | Install dependencies                                |
| `just format`          | Format code with Prettier                           |
| `just check`           | Check formatting, lint (ESLint), type-check         |
| `just test`            | Run tests (Vitest)                                  |
| `just build`           | Build the web project into `dist/`                  |
| `just package`         | Build and package for the Zelos marketplace         |
| `just release VERSION` | Bump version, check, test, build, commit, tag       |
| `just clean`           | Remove build output, caches and packages            |
| `just dev`             | Start the Vite dev server against a mock host       |
| `just watch`           | Rebuild `dist/` on every change                     |
| `just test-watch`      | Run the tests in watch mode                         |

`just --list` shows every recipe. Install [pre-commit](https://pre-commit.com) yourself and run
`pre-commit install` to run the hooks in `.pre-commit-config.yaml` on each commit.

## Run it in Zelos

```bash
just build
zelos extensions install-local .
```

A local install runs from your project directory, so you do not install again after a code
change:

- Tab: after a rebuild, reload the tab. Keep `just watch` running to rebuild on every save, and
  use `just dev` to work on it in the browser against the mock host of the SDK.
- `extension.toml`: run `zelos extensions install-local .` again.

The tab sends frames through the
[CAN extension](https://github.com/zeloscloud/zelos-extension-can), so install it on an agent
of a live workspace and configure a bus.

## Work in the browser

`just dev` serves the tab at `http://localhost:5173/tab/` against the mock host of the SDK and
a mock CAN extension with two buses and a demo DBC. Add `?mock=<state>` to the URL to see
another state: `can-extension-missing`, `can-extension-stopped`, `can-extension-outdated`,
`no-ready-buses` or `multi-agent`.

## Packaging

```bash
just package
```

The archive lands next to `extension.toml` as `<name>-<version>.tar.gz`, where `<name>` is the
manifest name in lowercase with every other run of characters turned into one hyphen. It holds
`extension.toml`, the README, the icon and the paths listed in `[package] paths`: `dist/`.

## Release

```bash
just release 1.0.0
git push --follow-tags
```

The release workflow checks, tests, builds and packages the extension, then attaches the
archive to a GitHub release.
