// Temporary lunch break: the IDE unlocks automatically at 13:30 Vietnam time.
const LUNCH_REOPEN_AT = Date.parse("2026-08-12T13:30:00+07:00");

window.FR5_MAINTENANCE_REOPEN_AT = LUNCH_REOPEN_AT;
window.FR5_MAINTENANCE_MODE = Date.now() < LUNCH_REOPEN_AT;
