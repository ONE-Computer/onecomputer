import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the owned UI exposes signed policy state and workspace protections without implementation authority", async () => {
  const [app, ui] = await Promise.all([
    source("apps/web/src/App.jsx"),
    source("apps/web/src/ui.jsx"),
  ]);
  assert.match(app, /<PolicyIntegrityCard integrity=\{workspace\?\.policyIntegrity\}/);
  assert.match(app, /Native copy and paste/);
  assert.match(app, /Controlled internet access/);
  assert.match(ui, /In workspace/);
  assert.match(ui, /Enforced/);
  assert.doesNotMatch(ui, /PRIVATE_KEY|SIGNING_PRIVATE|provider credential/i);
});

test("critical UI paths use owned accessible dialogs, skip targets, live state, and current dates", async () => {
  const [app, companion, ui] = await Promise.all([
    source("apps/web/src/App.jsx"),
    source("apps/web/src/CompanionApp.jsx"),
    source("apps/web/src/ui.jsx"),
  ]);
  assert.doesNotMatch(`${app}\n${companion}`, /window\.(confirm|prompt)/);
  assert.match(app, /href="#main-content"/);
  assert.match(companion, /href="#companion-main"/);
  assert.match(app, /aria-controls="primary-navigation"/);
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /event\.key !== "Tab"/);
  assert.match(app, /new Intl\.DateTimeFormat/);
  assert.doesNotMatch(app, /dateTime="2026-/);
});
