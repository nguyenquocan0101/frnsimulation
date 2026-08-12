import {
  buildSubmissionMetadata,
  canonicalFilename,
  createSubmissionIdentity,
  isSourceSizeValid,
  validateGroupName,
} from "./submission-model.mjs";
import { ONNX_RECOVERY_KEY } from "./onnx-submission-config.mjs";
import { validateOnnxFile } from "./onnx-submission-client.mjs";

export function createSubmissionController({ getSource, getModelFile, ensureUser, upload, uploadModel, progressNode, storage = globalThis.localStorage, onStatus } = {}) {
  let busy = false;
  let activeAbortController = null;

  const setStatus = (status, message = "") => onStatus?.(status, message);

  return {
    get busy() {
      return busy;
    },
    abort() {
      activeAbortController?.abort();
    },
    async submit(groupName) {
      if (busy) return { ok: false, reason: "busy" };
      const source = getSource?.() ?? "";
      if (!validateGroupName(groupName)) {
        setStatus("error", "Group names must be 2–30 ASCII letters or digits with no spaces.");
        return { ok: false, reason: "group" };
      }
      if (!isSourceSizeValid(source)) {
        setStatus("error", "Code must be between 1 and 100 KB.");
        return { ok: false, reason: "source" };
      }
      const modelFile = getModelFile?.();
      const modelRequired = typeof getModelFile === "function" || typeof uploadModel === "function";
      if (modelRequired) {
        try { validateOnnxFile(modelFile); } catch (error) {
          setStatus("error", error.message);
          return { ok: false, reason: "model", error };
        }
      }

      busy = true;
      activeAbortController = new AbortController();
      setStatus("validating", "Validating submission…");
      try {
        const user = await ensureUser();
        let recovery = null;
        try { recovery = JSON.parse(storage?.getItem(ONNX_RECOVERY_KEY) || "null"); } catch {}
        const fingerprint = modelFile
          ? `${modelFile.name}:${modelFile.size}:${modelFile.type || ""}:${groupName.toLowerCase()}`
          : "";
        const identity = recovery?.modelComplete && recovery.fileFingerprint === fingerprint
          ? { submissionId: recovery.submissionId }
          : createSubmissionIdentity({ uid: user.uid });
        const metadata = buildSubmissionMetadata({
          ...identity,
          uid: user.uid,
          groupName,
          source,
        });
        setStatus("uploading", `Uploading ${metadata.filename}…`);
        if (modelRequired && (!recovery?.modelComplete || recovery.fileFingerprint !== fingerprint || recovery.submissionId !== identity.submissionId)) {
          await uploadModel?.({ user, identity, metadata, file: modelFile, groupKey: metadata.groupKey, groupName, signal: activeAbortController.signal, onProgress: (value) => {
            if (progressNode) {
              progressNode.max = modelFile.size;
              progressNode.value = value;
            }
            setStatus("uploading", `Uploading model: ${value.toLocaleString()} / ${modelFile.size.toLocaleString()} bytes…`);
          } });
          try { storage?.setItem(ONNX_RECOVERY_KEY, JSON.stringify({ submissionId: identity.submissionId, fileFingerprint: fingerprint, modelComplete: true })); } catch {}
        }
        await upload({
          user,
          identity,
          metadata,
          source,
          onMetadata: () => setStatus("saving", "Saving submission to the list…"),
        });
        try { localStorage.setItem("techcamp-last-group", groupName); } catch {}
        try { storage?.removeItem(ONNX_RECOVERY_KEY); } catch {}
        setStatus("success", `${metadata.filename} submitted at ${new Date().toLocaleTimeString()}.`);
        return { ok: true, metadata };
      } catch (error) {
        if (error?.stage === "metadata") {
          setStatus("error", "The submission is not visible in the list yet. Try again.");
          return { ok: false, reason: "metadata", error };
        }
        setStatus("error", error?.message || "Unable to submit the file. Try again.");
        return { ok: false, reason: "network", error };
      } finally {
        activeAbortController = null;
        busy = false;
      }
    },
  };
}

export function initStudentSubmissionUi({
  openButton,
  dialog,
  form,
  groupInput,
  filenamePreview,
  statusNode,
  submitButton,
  modelInput,
  modelPreview,
  progressNode,
  getModelFile,
  uploadModel,
  getSource,
  ensureUser,
  upload,
  available = true,
  log,
} = {}) {
  if (!openButton || !dialog || !form || !groupInput) return null;

  const renderStatus = (status, message) => {
    if (statusNode) {
      statusNode.hidden = !message;
      statusNode.dataset.status = status;
      statusNode.textContent = message;
    }
    if (submitButton) submitButton.disabled = ["validating", "uploading", "saving"].includes(status);
    if (progressNode) {
      progressNode.hidden = !["uploading", "saving"].includes(status);
      if (status !== "uploading") progressNode.value = 0;
    }
  };
  const updatePreview = () => {
    const value = groupInput.value.trim();
    filenamePreview.textContent = validateGroupName(value) ? canonicalFilename(value) : "TechX_TenNhom.py";
  };
  const controller = createSubmissionController({
    getSource,
    getModelFile: getModelFile || (() => modelInput?.files?.[0] ?? null),
    ensureUser,
    upload,
    uploadModel,
    progressNode,
    storage: globalThis.localStorage,
    onStatus: renderStatus,
  });

  openButton.addEventListener("click", () => {
    form.reset();
    updatePreview();
    renderStatus(available ? "idle" : "error", available ? "" : "Firebase is not configured for this workshop.");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.hidden = false;
    groupInput.focus();
  });
  groupInput.addEventListener("input", updatePreview);
  modelInput?.addEventListener("change", () => {
    const file = modelInput.files?.[0];
    if (modelPreview) modelPreview.textContent = file ? `${file.name} · ${file.size.toLocaleString()} bytes` : "Choose one model.onnx file (maximum 1 GiB).";
  });
  form.addEventListener("reset", () => queueMicrotask(updatePreview));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!available) {
      renderStatus("error", "Firebase is not configured for this workshop.");
      return;
    }
    const result = await controller.submit(groupInput.value.trim());
    if (result.ok) log?.(`Upload complete: ${result.metadata.filename}`);
  });
  form.querySelectorAll("[data-upload-cancel]").forEach((cancelButton) => cancelButton.addEventListener("click", () => {
    controller.abort();
    if (dialog.open) dialog.close();
    else dialog.hidden = true;
  }));
  return controller;
}
