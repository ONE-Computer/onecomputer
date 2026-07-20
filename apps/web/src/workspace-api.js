const jsonHeaders = { "content-type": "application/json" };

async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? "ONEComputer could not complete the request.");
    error.code = payload?.error?.code ?? "REQUEST_FAILED";
    error.retryable = payload?.error?.retryable ?? false;
    throw error;
  }
  return payload;
}

const mutation = (method = "POST", body) => ({
  method,
  headers: { ...(body === undefined ? {} : jsonHeaders), "idempotency-key": crypto.randomUUID() },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const workspaceApi = {
  current: () => request("/api/v1/workspaces/current"),
  create: () => request("/api/v1/workspaces", mutation("POST", { grantId: "personal" })),
  open: (id) => request(`/api/v1/workspaces/${encodeURIComponent(id)}/open`, mutation()),
  restart: (id) => request(`/api/v1/workspaces/${encodeURIComponent(id)}/restart`, mutation()),
  stop: (id) => request(`/api/v1/workspaces/${encodeURIComponent(id)}/stop`, mutation()),
  testGateway: (id) => request(`/api/v1/workspaces/${encodeURIComponent(id)}/gateway/test`, mutation()),
  delete: (id) => request(`/api/v1/workspaces/${encodeURIComponent(id)}`, mutation("DELETE")),
};

export const operationApi = {
  recent: () => request("/api/v1/operations/recent"),
  get: (id) => request(`/api/v1/operations/${encodeURIComponent(id)}`),
  createDeleteFile: (workspaceId, path) => request("/api/v1/operations/delete-file", mutation("POST", { workspaceId, path })),
  decideWithFixture: (id, decision) => request(`/api/v1/operations/${encodeURIComponent(id)}/fixture-decision`, mutation("POST", { decision })),
};

export const connectionApi = {
  microsoft365: () => request("/api/v1/connections/microsoft-365"),
  microsoft365AuthorizeUrl: "/api/v1/connections/microsoft-365/authorize",
  disconnectMicrosoft365: () => request("/api/v1/connections/microsoft-365", mutation("DELETE")),
};
