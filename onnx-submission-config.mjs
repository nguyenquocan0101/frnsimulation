const browserHost = String(globalThis.location?.hostname || "").toLowerCase();
const localBrowser = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(browserHost);
const productionApiUrl = "https://obtained-durham-agent-envelope.trycloudflare.com";

// Local teacher testing talks to the loopback FastAPI process. Production keeps
// the explicitly republished Quick Tunnel URL. A page-level override remains
// available for staging or a temporary tunnel.
export const ONNX_API_BASE_URL =
  globalThis.__TECHCAMP_ONNX_API_URL__ || (localBrowser ? "http://127.0.0.1:8787" : productionApiUrl);
export const ONNX_MAX_FILE_SIZE = 1024 ** 3;
export const ONNX_CHUNK_SIZE = 8 * 1024 * 1024;
export const ONNX_RECOVERY_KEY = "techcamp-onnx-recovery";
