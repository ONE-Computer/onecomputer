// Shared HTTP helpers for the E2E API test suite.
// Extracted from scripts/onecomputer/e2e-gateway-approval-proof.mjs (req/get/post)
// and generalized with patch/del + header helpers used across areas.

export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:10254';
export const GATEWAY_INTERNAL_SECRET = process.env.GATEWAY_INTERNAL_SECRET ?? 'dev-secret-change-in-prod';
export const DEMO_PROJECT_ID = process.env.DEMO_PROJECT_ID ?? 'demo-corp-team-field-sales';

export async function req(url, opts = {}, allowNon2xx = false) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok && !allowNon2xx) {
    throw new Error(`${opts.method ?? 'GET'} ${url} -> ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return { status: res.status, body };
}

export async function get(url, headers = {}, allowNon2xx = false) {
  return req(url, { headers }, allowNon2xx);
}

export async function post(url, data, headers = {}, allowNon2xx = false) {
  return req(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(data),
  }, allowNon2xx);
}

export async function patch(url, data, headers = {}, allowNon2xx = false) {
  return req(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(data),
  }, allowNon2xx);
}

export async function del(url, headers = {}, allowNon2xx = false) {
  return req(url, { method: 'DELETE', headers }, allowNon2xx);
}

export function gatewaySecretHeaders(secret = GATEWAY_INTERNAL_SECRET) {
  return { 'x-gateway-secret': secret };
}

export function projectHeader(projectId = DEMO_PROJECT_ID) {
  return { 'x-project-id': projectId };
}

export async function getSession(apiBase = API_URL) {
  const { body } = await get(`${apiBase}/v1/auth/session`);
  return body;
}
