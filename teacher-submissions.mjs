export function normalizeFilter(value) {
  return String(value || "").trim().toLowerCase();
}

export function filterSubmissions(rows, filter) {
  const key = normalizeFilter(filter);
  if (!key) return [...rows];
  return rows.filter((row) => String(row.groupKey || row.groupName || "").toLowerCase().includes(key));
}

export function formatSubmissionTime(value, locale = undefined) {
  if (!value) return "Đang chờ thời gian…";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "Không rõ thời gian" : date.toLocaleString(locale);
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
      emptyNode.textContent = rows.length === 0 ? "Chưa có bài nộp." : "Không có bài của nhóm này.";
    }
    visible.forEach((row, index) => {
      const item = document.createElement("tr");
      item.className = "submission-row";
      item.dataset.submissionId = row.id || row.submissionId || "";
      const numberCell = document.createElement("td");
      numberCell.dataset.label = "STT";
      numberCell.textContent = String(index + 1);
      const groupCell = document.createElement("td");
      groupCell.dataset.label = "Tên nhóm";
      const group = document.createElement("strong");
      group.textContent = row.groupName || row.groupKey || "Không rõ nhóm";
      groupCell.append(group);
      const filenameCell = document.createElement("td");
      filenameCell.dataset.label = "Tên file";
      const filename = document.createElement("span");
      filename.textContent = typeof row.filename === "string" && row.filename ? row.filename : canonicalFilename(row);
      filenameCell.append(filename);
      const timeCell = document.createElement("td");
      timeCell.dataset.label = "Nộp lúc";
      timeCell.textContent = formatSubmissionTime(row.submittedAt);
      const actionsCell = document.createElement("td");
      actionsCell.dataset.label = "Thao tác";
      actionsCell.className = "submission-actions";
      const previewButton = document.createElement("button");
      previewButton.type = "button";
      previewButton.className = "button quiet preview-button";
      previewButton.textContent = "Xem trước";
      previewButton.dataset.action = "preview";
      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.className = "button primary download-button";
      downloadButton.textContent = "Tải .py";
      downloadButton.dataset.action = "download";
      actionsCell.append(previewButton, downloadButton);
      item.append(numberCell, groupCell, filenameCell, timeCell, actionsCell);
      rowsNode.append(item);
      previewButton.addEventListener("click", () => {
        activeTrigger = previewButton;
        if (previewDialog && previewCode && previewMeta) {
          previewCode.textContent = typeof row.source === "string" ? row.source : "Code không khả dụng cho bài nộp này.";
          previewMeta.textContent = `${canonicalFilename(row)} · ${row.groupName || row.groupKey || "Không rõ nhóm"} · ${formatSubmissionTime(row.submittedAt)}`;
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
        catch { setState("error", "Không thể tải file này."); }
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
    setState("loading", "Đang tải danh sách bài…");
    try {
      const nextRows = await list();
      rows = Array.isArray(nextRows) ? nextRows : [];
      lastUpdated = new Date();
      setState(rows.length ? "ready" : "empty", rows.length ? `${rows.length} bài · Cập nhật ${lastUpdated.toLocaleTimeString()}` : "Workshop công khai · Chưa có bài nộp");
      render();
      return true;
    } catch (error) {
      setState("error", error?.message || "Không thể tải danh sách bài nộp.");
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
