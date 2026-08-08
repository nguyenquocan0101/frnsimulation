const MIN_SOURCE_BYTES = 1;
const MAX_SOURCE_BYTES = 102400;
const GROUP_PATTERN = /^[A-Za-z0-9]{2,30}$/;

export function validateGroupName(value) {
  return typeof value === "string" && GROUP_PATTERN.test(value);
}

export function canonicalFilename(groupName) {
  if (!validateGroupName(groupName)) {
    throw new Error("Invalid group name");
  }
  return `TechX_${groupName}.py`;
}

export function normalizeGroupKey(groupName) {
  if (!validateGroupName(groupName)) {
    throw new Error("Invalid group name");
  }
  return groupName.toLowerCase();
}

export function utf8ByteSize(source) {
  if (typeof source !== "string") return 0;
  return new TextEncoder().encode(source).byteLength;
}

export function isSourceSizeValid(source) {
  const size = utf8ByteSize(source);
  return size >= MIN_SOURCE_BYTES && size <= MAX_SOURCE_BYTES;
}

function randomSubmissionId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replaceAll("-", "");
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}${random}`;
}

export function createSubmissionIdentity({ uid } = {}) {
  if (typeof uid !== "string" || !uid) throw new Error("Missing Firebase user id");
  const submissionId = randomSubmissionId();
  return { submissionId };
}

export function buildSubmissionMetadata({
  submissionId,
  uid,
  groupName,
  source,
} = {}) {
  if (!submissionId || typeof uid !== "string") {
    throw new Error("Incomplete submission identity");
  }
  if (!validateGroupName(groupName) || !isSourceSizeValid(source)) {
    throw new Error("Invalid submission");
  }
  return {
    submissionId,
    uid,
    groupKey: normalizeGroupKey(groupName),
    groupName,
    filename: canonicalFilename(groupName),
    byteSize: utf8ByteSize(source),
    contentType: "text/x-python",
    source,
  };
}

export const submissionLimits = Object.freeze({
  minBytes: MIN_SOURCE_BYTES,
  maxBytes: MAX_SOURCE_BYTES,
});
