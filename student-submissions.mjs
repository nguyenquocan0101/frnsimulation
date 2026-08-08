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
        setStatus("error", "Tên nhóm phải có 2–30 ký tự không dấu, viết liền (A–Z, a–z, 0–9).");
        return { ok: false, reason: "group" };
      }
      if (!isSourceSizeValid(source)) {
        setStatus("error", "Code phải có từ 1 đến 100 KB.");
        return { ok: false, reason: "source" };
      }

      busy = true;
      setStatus("validating", "Đang kiểm tra bài nộp…");
      try {
        const user = await ensureUser();
        const identity = createSubmissionIdentity({ uid: user.uid });
        const metadata = buildSubmissionMetadata({
          ...identity,
          uid: user.uid,
          groupName,
          source,
        });
        setStatus("uploading", `Đang tải ${metadata.filename}…`);
        await upload({
          user,
          identity,
          metadata,
          source,
          onMetadata: () => setStatus("saving", "Đang lưu bài vào danh sách…"),
        });
        setStatus("success", `${metadata.filename} đã được nộp lúc ${new Date().toLocaleTimeString()}.`);
        return { ok: true, metadata };
      } catch (error) {
        if (error?.stage === "metadata") {
          setStatus("error", "Bài chưa xuất hiện trong danh sách. Hãy thử lại.");
          return { ok: false, reason: "metadata", error };
        }
        setStatus("error", error?.message || "Không thể nộp bài. Hãy thử lại.");
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
    renderStatus(available ? "idle" : "error", available ? "" : "Firebase chưa được cấu hình cho workshop.");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.hidden = false;
    groupInput.focus();
  });
  groupInput.addEventListener("input", updatePreview);
  form.addEventListener("reset", () => queueMicrotask(updatePreview));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!available) {
      renderStatus("error", "Firebase chưa được cấu hình cho workshop.");
      return;
    }
    const result = await controller.submit(groupInput.value.trim());
    if (result.ok) log?.(`Upload ${result.metadata.filename} thành công`);
  });
  form.querySelectorAll("[data-upload-cancel]").forEach((cancelButton) => cancelButton.addEventListener("click", () => {
    if (dialog.open) dialog.close();
    else dialog.hidden = true;
  }));
  return controller;
}
