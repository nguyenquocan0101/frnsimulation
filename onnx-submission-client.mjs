import {
  ONNX_API_BASE_URL,
  ONNX_CHUNK_SIZE,
  ONNX_MAX_FILE_SIZE,
} from "./onnx-submission-config.mjs";

export class OnnxUploadError extends Error {
  constructor(category, message, options = {}) {
    super(message, options);
    this.name = "OnnxUploadError";
    this.category = category;
    this.status = options.status;
  }
}

export function validateOnnxFile(file) {
  if (!file || typeof file.name !== "string" || !file.name.toLowerCase().endsWith(".onnx") || file.name.includes("/") || file.name.includes("\\")) {
    throw new OnnxUploadError("invalid-file", "Select one .onnx model file.");
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new OnnxUploadError("invalid-file", "The ONNX model cannot be empty.");
  }
  if (file.size > ONNX_MAX_FILE_SIZE) {
    throw new OnnxUploadError("oversized", "The ONNX model is larger than 1 GiB.");
  }
  return true;
}

function mapError(error, fallback = "ONNX upload failed.") {
  if (error instanceof OnnxUploadError) return error;
  if (error?.name === "AbortError") return new OnnxUploadError("aborted", "ONNX upload cancelled.", { cause: error });
  return new OnnxUploadError("network", error?.message || fallback, { cause: error });
}

export function createOnnxSubmissionClient({
  baseUrl = ONNX_API_BASE_URL,
  getIdToken,
  fetchImpl = globalThis.fetch,
  chunkSize = ONNX_CHUNK_SIZE,
  maxFileSize = ONNX_MAX_FILE_SIZE,
} = {}) {
  const request = async (url, options = {}) => {
    let response;
    try {
      const token = await getIdToken?.();
      response = await fetchImpl(`${baseUrl}${url}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token || ""}`,
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      throw mapError(error);
    }
    if (response.ok) return response;
    const category = response.status === 401 ? "auth" : response.status === 409 ? "conflict" : response.status === 413 ? "oversized" : response.status >= 500 ? "server" : "invalid-file";
    throw new OnnxUploadError(category, `ONNX upload failed (${response.status}).`, { status: response.status });
  };

  const uploadModel = async ({ submissionId, file, groupKey, groupName, signal, onProgress } = {}) => {
    validateOnnxFile(file);
    if (file.size > maxFileSize) throw new OnnxUploadError("oversized", "The ONNX model is larger than 1 GiB.");
    if (signal?.aborted) throw new OnnxUploadError("aborted", "ONNX upload cancelled.");
    let init;
    try {
      init = await (await request("/v1/uploads", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, groupKey, groupName, filename: file.name, size: file.size }),
      })).json();
      let uploadId = init.uploadId;
      let offset = Number(init.offset || 0);
      const effectiveChunk = Math.min(Number(init.chunkSize) || chunkSize, chunkSize);
      while (offset < file.size) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const end = Math.min(file.size, offset + effectiveChunk);
        let acknowledged = false;
        for (let attempt = 0; attempt < 3 && !acknowledged; attempt += 1) {
          try {
            const response = await request(`/v1/uploads/${encodeURIComponent(uploadId)}/chunks?offset=${offset}`, {
              method: "PUT",
              signal,
              headers: { "Content-Type": "application/octet-stream", "Content-Length": String(end - offset) },
              body: file.slice(offset, end),
            });
            const payload = await response.json();
            offset = Number(payload.offset);
            acknowledged = true;
            onProgress?.(offset);
          } catch (error) {
            if (error instanceof OnnxUploadError && error.category === "network" && attempt < 2) {
              const status = await request(`/v1/uploads/${encodeURIComponent(uploadId)}`, { method: "GET", signal });
              offset = Number((await status.json()).offset);
              continue;
            }
            throw error;
          }
        }
        if (!acknowledged) throw new OnnxUploadError("network", "Unable to acknowledge model chunk.");
      }
      return await (await request(`/v1/uploads/${encodeURIComponent(uploadId)}/complete`, { method: "POST", signal })).json();
    } catch (error) {
      throw mapError(error);
    }
  };
  return { uploadModel };
}
