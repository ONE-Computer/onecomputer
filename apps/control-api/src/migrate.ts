import { PostgresWorkspaceStore } from "@onecomputer/workspace-store";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const store = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL);
await store.migrate();
await store.close();
