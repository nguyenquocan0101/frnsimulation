export function normalizeFilter(value) {
  return String(value || "").trim().toLowerCase();
}

export function filterSubmissions(rows, filter) {
  const key = normalizeFilter(filter);
  if (!key) return [...rows];
  return rows.filter((row) => String(row.groupKey || row.groupName || "").toLowerCase().includes(key));
}

export function formatSubmissionTime(value, locale = undefined) {
  if (!value) return "Waiting for timestamp…";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString(locale);
}

function canonicalFilename(row = {}) {
  const raw = String(row.groupName || row.groupKey || "Nhom").trim();
  const group = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 30) || "Nhom";
  return `TechX_${group}.py`;
}

function setVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
}

export function joinSubmissionModels(rows = [], models, error = null) {
  const modelMap = new Map((Array.isArray(models) ? models : []).map((model) => [model.submissionId, model]));
  return rows.map((row) => {
    const id = row.id || row.submissionId;
    const model = error ? { status: "error", message: error.message || error.error || String(error) } : modelMap.has(id) ? { status: "present", ...modelMap.get(id) } : { status: "missing", message: "Model unavailable" };
    return { ...row, model };
  });
}

export function initTeacherPortal({
  list,
  download,
  statusNode,
  rowsNode,
  filterInput,
  refreshButton,
  emptyNode,
  errorNode,
  previewDialog,
  previewCode,
  previewMeta,
  previewCloseButton,
  listModels,
  downloadModel,
} = {}) {
  if (!list || !statusNode || !rowsNode || !filterInput || !refreshButton) return null;
  let rows = [];
  let busy = false;
  let lastUpdated = null;
  let activeTrigger = null;

  const setState = (status, message) => {
    statusNode.dataset.status = status;
    statusNode.textContent = message;
    if (errorNode) {
      errorNode.dataset.status = status === "error" ? "error" : "idle";
      errorNode.textContent = status === "error" ? message : "";
      setVisible(errorNode, status === "error");
    }
  };

  const render = () => {
    const visible = filterSubmissions(rows, filterInput.value);
    rowsNode.replaceChildren();
    setVisible(emptyNode, rows.length === 0 || visible.length === 0);
    if (emptyNode) {
      emptyNode.dataset.status = rows.length === 0 ? "empty" : "filtered-empty";
      emptyNode.textContent = rows.length === 0 ? "No submissions yet." : "No submissions match this group.";
    }
    visible.forEach((row, index) => {
      const item = document.createElement("tr");
      item.className = "submission-row";
      item.dataset.submissionId = row.id || row.submissionId || "";
      const numberCell = document.createElement("td");
      numberCell.dataset.label = "No.";
      numberCell.textContent = String(index + 1);
      const groupCell = document.createElement("td");
      groupCell.dataset.label = "Group";
      const group = document.createElement("strong");
      group.textContent = row.groupName || row.groupKey || "Unknown group";
      groupCell.append(group);
      const filenameCell = document.createElement("td");
      filenameCell.dataset.label = "File";
      const filename = document.createElement("span");
      filename.textContent = typeof row.filename === "string" && row.filename ? row.filename : canonicalFilename(row);
      filenameCell.append(filename);
      const timeCell = document.createElement("td");
      timeCell.dataset.label = "Submitted";
      timeCell.textContent = formatSubmissionTime(row.submittedAt);
      const actionsCell = document.createElement("td");
      actionsCell.dataset.label = "Actions";
      actionsCell.className = "submission-actions";
      const previewButton = document.createElement("button");
      previewButton.type = "button";
      previewButton.className = "button quiet preview-button";
      previewButton.textContent = "Preview";
      previewButton.dataset.action = "preview";
      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.className = "button primary download-button";
      downloadButton.textContent = "Download .py";
      downloadButton.dataset.action = "download";
      actionsCell.append(previewButton, downloadButton);
      const modelStatus = document.createElement("span");
      modelStatus.textContent = row.model?.status === "present" ? `ONNX · ${Number(row.model.size).toLocaleString()} bytes` : row.model?.status === "error" ? `ONNX error: ${row.model.message}` : "ONNX missing";
      actionsCell.append(modelStatus);
      if (row.model?.status === "present" && downloadModel) {
        const modelButton = document.createElement("button");
        modelButton.type = "button";
        modelButton.className = "button primary";
        modelButton.textContent = "Download ONNX";
        modelButton.addEventListener("click", () => downloadModel(row.id || row.submissionId));
        actionsCell.append(modelButton);
      }
      item.append(numberCell, groupCell, filenameCell, timeCell, actionsCell);
      rowsNode.append(item);
      previewButton.addEventListener("click", () => {
        activeTrigger = previewButton;
        if (previewDialog && previewCode && previewMeta) {
          previewCode.textContent = typeof row.source === "string" ? row.source : "Source code is unavailable for this submission.";
          previewMeta.textContent = `${canonicalFilename(row)} · ${row.groupName || row.groupKey || "Unknown group"} · ${formatSubmissionTime(row.submittedAt)}`;
          if (typeof previewDialog.showModal === "function") previewDialog.showModal();
          else previewDialog.open = true;
        }
        rowsNode.dispatchEvent?.(new CustomEvent("teacher:preview", { detail: { row, trigger: previewButton } }));
      });
      downloadButton.addEventListener("click", async () => {
        if (!download || typeof row.source !== "string") return;
        downloadButton.disabled = true;
        try {
          const blob = await download(row.source, canonicalFilename(row));
          if (blob instanceof Blob && typeof URL?.createObjectURL === "function") {
            const objectUrl = URL.createObjectURL(blob);
            const anchor = globalThis.document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = canonicalFilename(row);
            try { anchor.click(); } finally { URL.revokeObjectURL(objectUrl); }
          }
        }
        catch { setState("error", "Unable to download this file."); }
        finally { downloadButton.disabled = false; }
      });
    });
  };

  const closePreview = () => {
    if (!previewDialog) return;
    if (typeof previewDialog.close === "function") previewDialog.close();
    else previewDialog.open = false;
    activeTrigger?.focus?.();
  };

  previewCloseButton?.addEventListener("click", closePreview);
  previewDialog?.addEventListener("click", (event) => {
    if (event.target === previewDialog) closePreview();
  });
  globalThis.document?.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape" && previewDialog?.open) closePreview();
  });

  const refresh = async () => {
    if (busy) return false;
    busy = true;
    refreshButton.disabled = true;
    setState("loading", "Loading submissions…");
    try {
      const nextRows = await list();
      let modelResult = { models: [] };
      try { modelResult = listModels ? await listModels() : modelResult; } catch (error) { modelResult = { error }; }
      rows = joinSubmissionModels(Array.isArray(nextRows) ? nextRows : [], modelResult.models, modelResult.error);
      lastUpdated = new Date();
      setState(rows.length ? "ready" : "empty", rows.length ? `${rows.length} submissions · Updated ${lastUpdated.toLocaleTimeString()}` : "Public workshop · No submissions yet");
      render();
      return true;
    } catch (error) {
      setState("error", error?.message || "Unable to load submissions.");
      render();
      setVisible(emptyNode, false);
      return false;
    } finally {
      busy = false;
      refreshButton.disabled = false;
    }
  };

  filterInput.addEventListener("input", render);
  refreshButton.addEventListener("click", refresh);
  const pollTimer = setInterval(() => { void refresh(); }, 3000);
  pollTimer?.unref?.();
  void refresh();
  return {
    refresh,
    render,
    dispose() { clearInterval(pollTimer); },
    get rows() { return [...rows]; },
    get lastUpdated() { return lastUpdated; },
  };
}
