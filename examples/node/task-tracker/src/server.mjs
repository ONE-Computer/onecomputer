import crypto from "node:crypto";
import express from "express";
import {
  DynamoDBClient,
  PutItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const app = express();
const port = Number(process.env.PORT || 3000);
const tableName = process.env.ONECOMPUTER_DYNAMODB_TABLE;
const region =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-southeast-1";
const ddb = tableName ? new DynamoDBClient({ region }) : null;

app.use(express.json());

app.get("/health", (_, res) => res.type("text").send("ok"));

async function listTasks() {
  if (!ddb || !tableName) {
    return [
      {
        id: "local-demo",
        title: "Configure DynamoDB with --db dynamodb",
        status: "Local fallback",
      },
    ];
  }
  const out = await ddb.send(
    new ScanCommand({ TableName: tableName, Limit: 25 }),
  );
  return (out.Items || []).map((item) => unmarshall(item));
}

async function createTask(title, status = "Open") {
  const task = {
    id: crypto.randomUUID(),
    title: String(title || "Untitled task").slice(0, 200),
    status: String(status || "Open").slice(0, 80),
    createdAt: new Date().toISOString(),
  };
  if (ddb && tableName) {
    await ddb.send(
      new PutItemCommand({ TableName: tableName, Item: marshall(task) }),
    );
  }
  return task;
}

app.get("/api/tasks", async (_, res, next) => {
  try {
    res.json({ tasks: await listTasks(), table: tableName || null });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks", async (req, res, next) => {
  try {
    res
      .status(201)
      .json({ task: await createTask(req.body?.title, req.body?.status) });
  } catch (err) {
    next(err);
  }
});

app.get("/", async (_, res, next) => {
  try {
    const tasks = await listTasks();
    res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OneComputer Node Task Tracker</title>
<style>body{font-family:Inter,system-ui,sans-serif;margin:0;background:#0f172a;color:#f8fafc}main{max-width:920px;margin:0 auto;padding:48px 20px}.card{background:#111827;border:1px solid #334155;border-radius:20px;padding:24px}.pill{display:inline-block;border:1px solid #22c55e;color:#86efac;border-radius:999px;padding:4px 10px;font-size:12px}input,button{font:inherit;padding:10px;border-radius:10px;border:1px solid #475569}button{background:#22c55e;color:#052e16;font-weight:700}li{margin:10px 0;color:#cbd5e1}.muted{color:#94a3b8}</style></head>
<body><main><div class="card"><span class="pill">OneComputer governed Node.js + DynamoDB</span><h1>Node Task Tracker</h1><p class="muted">A tiny Node.js app with simple persistence used to prove OneComputer can host more than Streamlit.</p><form method="post" action="/api/tasks" onsubmit="event.preventDefault(); fetch('/api/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:this.title.value,status:'Open'})}).then(()=>location.reload())"><input name="title" placeholder="New task"><button>Add task</button></form><h2>Tasks</h2><ul>${tasks.map((task) => `<li><strong>${task.title}</strong> — ${task.status}</li>`).join("")}</ul><p class="muted">Table: ${tableName || "local fallback/no DB"}</p></div></main></body></html>`);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: String(err?.message || err) });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`OneComputer Node task tracker listening on ${port}`);
});
