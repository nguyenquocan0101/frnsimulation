const statusNode = document.querySelector("#status");
const endpoint = "wss://localhost:8766";

function setStatus(text) {
  if (statusNode) statusNode.textContent = text;
}

// The spike deliberately sends the pairing token in the first application
// message, never in a URL/query string. A real token is entered locally.
const token = window.prompt("Enter the local bridge token:") || "";
const socket = new WebSocket(endpoint);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "pair",
    token,
    probe: { type: "health_probe", version: "wss-probe-v1" },
  }));
  setStatus("Connected; probe sent.");
});
socket.addEventListener("message", (event) => {
  try {
    const message = JSON.parse(event.data);
    setStatus(message.status === "ok" ? "WSS probe succeeded." : "Unexpected bridge response.");
  } catch {
    setStatus("Invalid bridge response.");
  }
});
socket.addEventListener("error", () => setStatus("WSS probe failed."));
socket.addEventListener("close", () => setStatus("WSS connection closed."));
