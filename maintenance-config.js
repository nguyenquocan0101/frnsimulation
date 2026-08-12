// Production switch: set to false and deploy to bring the IDE back everywhere.
const MAINTENANCE_MODE = false;

// Keep local development usable while the public workshop site is paused.
// Set this to true only when you want to preview the maintenance screen locally.
const LOCAL_MAINTENANCE_MODE = true;
const localHost = ["", "localhost", "127.0.0.1", "[::1]"].includes(
  window.location.hostname,
);

window.FR5_MAINTENANCE_MODE = localHost
  ? LOCAL_MAINTENANCE_MODE
  : MAINTENANCE_MODE;
