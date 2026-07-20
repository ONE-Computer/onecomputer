import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("the stable assistant alias has one pinned real route and no fallback", async () => {
  for (const configPath of ["infra/issue-002/litellm-config.yaml", "infra/issue-008/litellm-config.yaml"]) {
    const config = await source(configPath);
    assert.equal((config.match(/model_name: onecomputer-assistant/g) ?? []).length, 1);
    assert.match(config, /model: openai\/gpt-5\.6-luna/);
    assert.match(config, /api_key: os\.environ\/OPENAI_API_KEY/);
    assert.doesNotMatch(config, /onecomputer-fixture|fallbacks:/);
    assert.match(config, /turn_off_message_logging: true/);
    assert.match(config, /log_raw_request_response: false/);
  }
});

test("the provider credential is injected only into LiteLLM", async () => {
  const compose = await source("infra/issue-002/compose.yml");
  const litellm = compose.split("  litellm:")[1]?.split("\n  workspace-controller:")[0] ?? "";
  const everythingElse = compose.replace(litellm, "");
  assert.match(litellm, /OPENAI_API_KEY: \$\{ONECOMPUTER_OPENAI_API_KEY:/);
  assert.doesNotMatch(everythingElse, /ONECOMPUTER_OPENAI_API_KEY/);
  assert.doesNotMatch(compose, /ONECOMPUTER_(?:CLAUDE|GLM)_API_KEY/);
});

test("the sandbox agent uses only the assigned alias and supports normal and streaming calls", async () => {
  const agent = await source("infra/issue-006/onecomputer-agent.py");
  assert.match(agent, /ONECOMPUTER_MODEL_ALIAS/);
  assert.match(agent, /command in \("chat", "stream"\)/);
  assert.match(agent, /"stream": stream/);
  assert.doesNotMatch(agent, /gpt-5\.6-luna|ONECOMPUTER_OPENAI_API_KEY/);
});
