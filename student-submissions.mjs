import {
  buildSubmissionMetadata,
  canonicalFilename,
  createSubmissionIdentity,
  isSourceSizeValid,
  validateGroupName,
} from "./submission-model.mjs";

export function createSubmissionController({ getSource, ensureUser, upload, onStatus } = {}) {
  let busy = false;

  const setStatus = (status, message = "") => onStatus?.(status, message);

  return {
    get busy() {
      return busy;
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

      busy = true;
      setStatus("validating", "Validating submission…");
      try {
        const user = await ensureUser();
        const identity = createSubmissionIdentity({ uid: user.uid });
        const metadata = buildSubmissionMetadata({
          ...identity,
          uid: user.uid,
          groupName,
          source,
        });
        setStatus("uploading", `Uploading ${metadata.filename}…`);
        await upload({
          user,
          identity,
          metadata,
          source,
          onMetadata: () => setStatus("saving", "Saving submission to the list…"),
        });
        try { localStorage.setItem("techcamp-last-group", groupName); } catch {}
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
  };
  const updatePreview = () => {
    const value = groupInput.value.trim();
    filenamePreview.textContent = validateGroupName(value) ? canonicalFilename(value) : "TechX_TenNhom.py";
  };
  const controller = createSubmissionController({ getSource, ensureUser, upload, onStatus: renderStatus });

  openButton.addEventListener("click", () => {
    form.reset();
    updatePreview();
    renderStatus(available ? "idle" : "error", available ? "" : "Firebase is not configured for this workshop.");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.hidden = false;
    groupInput.focus();
  });
  groupInput.addEventListener("input", updatePreview);
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
    if (dialog.open) dialog.close();
    else dialog.hidden = true;
  }));
  return controller;
}
