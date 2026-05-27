# zelos-app-can-tx

CAN transmit marketplace app extension. Pairs with the
[`zeloscloud.zelos-extension-can`](https://github.com/zeloscloud/zelos-extension-can)
agent extension to send CAN frames (raw + DBC, one-shot + periodic) through any
connected Zelos agent.

## Status

Scaffold + foundation. The bridge client, capability resolver, mock host, and
polling layer are wired; the full PCAN-style UI is a follow-up.

## Layout

```
src/
  App.tsx                v0 shell — disabled banner / ready snapshot / quick-send buttons
  main.tsx               Bridge provider + QueryClient + mock host bootstrap
  lib/
    types.ts             Wire shapes (CanTransmitState, action paths, request/response)
    can-bridge.ts        Typed wrapper over actions.execute for each CAN action
    capability.ts        Pure resolver: inputs → { kind: "ready" | "disabled" }
    capability.test.ts   T14 — one fixture per disabled reason
  hooks/
    use-tx-state.ts      TanStack Query polling for get_tx_state (2s while periodics active)
    use-capability.ts    Composes extensions/actions/tx-state queries through the resolver
  mocks/
    can-mock.ts          Standalone-mode MockBridge invoke handler (stateful periodics)
```

## Local development

```bash
npm install
npm run dev          # http://localhost:5173 — standalone with mock host
npm test             # vitest (capability resolver + App shell)
npm run check        # lint + tsc
```

### Mock scenarios

Override the standalone mock state via `?mock=<scenario>`:

- `?mock=ready` (default) — CAN extension running, two buses (`busA`, `busB`) both ready
- `?mock=can-extension-missing`
- `?mock=can-extension-stopped`
- `?mock=no-ready-buses` — extension running but no bus has the full action set
- `?mock=multi-agent` — `localhost:2300` missing the extension, `remote:2300` ready

### Bridge SDK (local link)

This app currently consumes `@zeloscloud/app-extension-sdk` from a sibling
worktree:

```json
"@zeloscloud/app-extension-sdk": "file:../src/.claude/worktrees/can-tx-bridge/web/app-extension-sdk"
```

The new `actions.*` + `extensions.list` bridge surface ships with the monorepo
PR for Phase 1. Once that lands and the SDK publishes a new tag, switch the
dependency back to a versioned range (e.g. `^0.2.0`).

## Packaging

```bash
npm run package      # zelos extensions package . (lists files, builds .tar.gz)
```

The manifest pins the host (`zelos >= 26.0.3` for the bridge surface) and
declares a hard dependency on the CAN agent extension via `[[requires]]` so
the marketplace install flow can surface a clear "missing dependency" state.
