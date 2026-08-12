// Temporary lunch break: the IDE unlocks automatically at 13:30 Vietnam time.
const LUNCH_REOPEN_AT = Date.parse("2026-08-12T13:30:00+07:00");
const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "[::1]"]);
const isLocalDevelopment = LOCAL_HOSTS.has(window.location.hostname);

window.FR5_MAINTENANCE_REOPEN_AT = LUNCH_REOPEN_AT;
window.FR5_MAINTENANCE_MODE =
  !isLocalDevelopment && Date.now() < LUNCH_REOPEN_AT;
