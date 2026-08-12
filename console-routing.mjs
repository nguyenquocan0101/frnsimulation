const MOTION_LOG_PREFIX = /^(?:MoveJ|MoveL|ServoJ)\b/;

export function consoleChannelForMessage(message) {
  return MOTION_LOG_PREFIX.test(String(message)) ? "motion" : "ide";
}
