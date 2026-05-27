import { MockBridge } from "@zeloscloud/app-extension-sdk";
import { useZelosBridge, ZelosBridgeProvider } from "@zeloscloud/app-extension-sdk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { installCanMockHost, type MockScenario } from "./mocks/can-mock";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

/** Installs the mock host scenario whenever the bridge enters standalone mode.
 *  Embedded mode is a no-op: the real desktop host owns invoke dispatch. */
function MockHostBootstrap({ scenario }: { scenario: MockScenario }) {
  const bridge = useZelosBridge();
  React.useEffect(() => {
    if (bridge.status !== "ready" || bridge.mode !== "standalone") return;
    if (!(bridge.bridge instanceof MockBridge)) return;
    return installCanMockHost(bridge.bridge, { scenario });
  }, [bridge, scenario]);
  return null;
}

/** Override via `?mock=can-extension-stopped` (etc.) in standalone dev to exercise
 *  any capability state without editing source. */
function readScenarioFromQuery(): MockScenario {
  if (typeof window === "undefined") return "ready";
  const param = new URLSearchParams(window.location.search).get("mock");
  switch (param) {
    case "can-extension-missing":
    case "can-extension-stopped":
    case "can-actions-missing":
    case "multi-agent":
      return param;
    default:
      return "ready";
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

const scenario = readScenarioFromQuery();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ZelosBridgeProvider>
      <QueryClientProvider client={queryClient}>
        <MockHostBootstrap scenario={scenario} />
        <App />
      </QueryClientProvider>
    </ZelosBridgeProvider>
  </React.StrictMode>,
);
