const SESSION_KEY = "techcamp-teacher-session";

export function createTeacherAccess({ baseUrl = globalThis.__TECHCAMP_ONNX_API_URL__ || "http://localhost:8787", fetchImpl = globalThis.fetch, storage = globalThis.sessionStorage } = {}) {
  const save = (value) => { try { storage?.setItem(SESSION_KEY, JSON.stringify(value)); } catch {} };
  const read = () => { try { return JSON.parse(storage?.getItem(SESSION_KEY) || "null"); } catch { return null; } };
  const clear = () => { try { storage?.removeItem(SESSION_KEY); } catch {} };
  const session = () => { const value = read(); return value?.token && value.expiresAt > Date.now() ? value : null; };
  async function request(path, options = {}) {
    const current = session();
    const response = await fetchImpl(`${baseUrl}${path}`, { ...options, headers: { ...(options.headers || {}), ...(current ? { Authorization: `Bearer ${current.token}` } : {}) } });
    if (response.status === 401) clear();
    if (!response.ok) throw new Error(`Teacher API failed (${response.status}).`);
    return response;
  }
  return {
    get session() { return session(); },
    async unlockTeacher(password) {
      const response = await fetchImpl(`${baseUrl}/v1/teacher/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!response.ok) throw new Error("Invalid teacher password.");
      const body = await response.json();
      save({ token: body.token, expiresAt: Date.now() + Number(body.expiresIn || 3600) * 1000 });
      return session();
    },
    async listModels() { return (await request("/v1/teacher/models")).json(); },
    async createRealJob({ submissionId, source, robotModel, siteId = "default", robotId, pointsTable = "points_HCM.json", modelAvailable = false }) {
      const response = await request("/v1/teacher/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, source, robotModel, siteId, robotId, pointsTable, modelAvailable, action: "real_run" }),
      });
      return response.json();
    },
    async getAgentStatus() { return (await request("/v1/teacher/agent-status")).json(); },
    async listJobs() { return (await request("/v1/teacher/jobs")).json(); },
    async getJob(jobId) { return (await request(`/v1/teacher/jobs/${encodeURIComponent(jobId)}`)).json(); },
    async confirmRealJob(jobId) {
      const response = await request(`/v1/teacher/jobs/${encodeURIComponent(jobId)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "physical_run" }),
      });
      return response.json();
    },
    async stopJob(jobId) {
      const response = await request(`/v1/teacher/jobs/${encodeURIComponent(jobId)}/stop`, { method: "POST" });
      return response.json();
    },
    async downloadModel(submissionId) {
      const ticket = await (await request(`/v1/teacher/models/${encodeURIComponent(submissionId)}/download-ticket`, { method: "POST" })).json();
      const anchor = globalThis.document?.createElement("a");
      if (!anchor) throw new Error("Browser download unavailable.");
      anchor.href = `${baseUrl}/v1/teacher/models/${encodeURIComponent(submissionId)}/download?ticket=${encodeURIComponent(ticket.ticket)}`;
      anchor.download = "model.onnx";
      anchor.click();
    },
    clear,
  };
}

export const requireTeacherSession = (access) => Boolean(access?.session);
