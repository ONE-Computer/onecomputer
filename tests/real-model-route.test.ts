import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("the approved model aliases have pinned real routes and no fallback", async () => {
  const config = await source("infra/issue-008/litellm-config.yaml");
  for (const alias of ["onecomputer-assistant", "onecomputer-claude", "onecomputer-openai", "onecomputer-glm"]) {
    assert.equal((config.match(new RegExp(`model_name: ${alias}`, "g")) ?? []).length, 1);
  }
  assert.match(config, /model: anthropic\/claude-sonnet-4-6/);
  assert.match(config, /model: openai\/gpt-5\.6-luna/);
  assert.match(config, /model: zai\/glm-5/);
  assert.match(config, /model_name: claude-sonnet-4-6\s+litellm_params:\s+model: anthropic\/claude-sonnet-4-6/);
  assert.match(config, /model_name: claude-opus-4-6\s+litellm_params:\s+model: openai\/gpt-5\.6-luna/);
  assert.match(config, /model_name: claude-sonnet-4-5\s+litellm_params:\s+model: zai\/glm-5/);
  assert.doesNotMatch(config, /fallbacks:/);
  assert.match(config, /turn_off_message_logging: true/);
  assert.match(config, /log_raw_request_response: false/);
});

test("the provider credential is injected only into LiteLLM", async () => {
  const compose = await source("infra/issue-002/compose.yml");
  const litellm = compose.split("  litellm:")[1]?.split("\n  workspace-controller:")[0] ?? "";
  const everythingElse = compose.replace(litellm, "");
  assert.match(litellm, /OPENAI_API_KEY: \$\{ONECOMPUTER_OPENAI_API_KEY:/);
  assert.match(litellm, /ANTHROPIC_API_KEY: \$\{ONECOMPUTER_CLAUDE_API_KEY:/);
  assert.match(litellm, /ZAI_API_KEY: \$\{ONECOMPUTER_GLM_API_KEY:/);
  assert.doesNotMatch(everythingElse, /ONECOMPUTER_(?:OPENAI|CLAUDE|GLM)_API_KEY/);
});

test("Claude Desktop is pinned and receives managed gateway policy rather than provider credentials", async () => {
  const dockerfile = await source("infra/issue-010/Dockerfile.workspace");
  const entrypoint = await source("infra/issue-010/onecomputer-workspace-entrypoint.sh");
  const proxy = await source("infra/issue-010/onecomputer-gateway-proxy.py");
  assert.match(dockerfile, /CLAUDE_DESKTOP_VERSION=1\.22209\.3/);
  assert.match(dockerfile, /CLAUDE_DESKTOP_SHA256=d427f46a/);
  assert.match(dockerfile, /CLAUDE_CODE_VERSION=2\.1\.215/);
  assert.match(dockerfile, /CLAUDE_CODE_SHA256=7ff9594e/);
  assert.match(dockerfile, /claude-code-releases\/\$\{CLAUDE_CODE_VERSION\}\/linux-x64\/claude\.zst/);
  assert.match(dockerfile, /claude --version/);
  assert.match(entrypoint, /Claude-3p\/claude-code\/\$\{claude_code_version\}/);
  assert.match(entrypoint, /\.verified/);
  assert.match(entrypoint, /\/etc\/claude-desktop\/managed-settings\.json/);
  assert.match(entrypoint, /"inferenceGatewayBaseUrl": "http:\/\/127\.0\.0\.1:4312"/);
  assert.doesNotMatch(entrypoint, /inferenceGatewayBaseUrl[^\n]+4312\/v1/);
  assert.match(entrypoint, /"disableDeploymentModeChooser": True/);
  assert.match(entrypoint, /"isLocalDevMcpEnabled": False/);
  assert.match(entrypoint, /"isDesktopExtensionEnabled": False/);
  assert.match(entrypoint, /claude-sonnet-4-5/);
  assert.match(proxy, /ALLOWED_PATHS = \{"\/v1\/messages", "\/v1\/models"\}/);
  assert.doesNotMatch(`${dockerfile}\n${entrypoint}\n${proxy}`, /ONECOMPUTER_(?:OPENAI|CLAUDE|GLM)_API_KEY|LITELLM_MASTER_KEY/);
});
