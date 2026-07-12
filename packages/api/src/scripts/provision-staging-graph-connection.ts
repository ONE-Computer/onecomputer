import { db } from "@onecli/db";
import { getGraphToken, loadAzureCreds } from "../services/azure-alert-service";
import {
  createConnection,
  listConnectionsByProvider,
  reconnectConnection,
} from "../services/connection-service";
import { updateAgentAppConnections } from "../services/agent-service";

/**
 * Provision the short-lived staging Graph credential used by the hosted E2E.
 *
 * The access token is acquired from the VM's Azure app credentials, encrypted
 * with ONEComputer's SECRET_ENCRYPTION_KEY, and stored only in AppConnection.
 * It is never printed, copied into a sandbox, or returned by this script.
 */
const projectId =
  process.env.ONECOMPUTER_E2E_PROJECT_ID ?? "demo-corp-team-field-sales";
const agentIdentifier = process.env.ONECOMPUTER_E2E_AGENT ?? "default";

const main = async () => {
  const azureCreds = await loadAzureCreds();
  if (!azureCreds) {
    throw new Error("Azure app credentials are unavailable on this host");
  }

  const accessToken = await getGraphToken(azureCreds);
  const scope = { projectId };
  const metadata = {
    name: "Microsoft Graph Outlook (staging E2E)",
    host: "graph.microsoft.com",
  };

  const existing = (
    await listConnectionsByProvider(scope, "microsoft-graph")
  )[0];
  const connection = existing
    ? await reconnectConnection(
        scope,
        existing.id,
        { access_token: accessToken },
        {
          scopes: ["Mail.Send"],
          metadata,
          label: "Microsoft Graph Outlook (staging E2E)",
        },
      )
    : await createConnection(
        scope,
        "microsoft-graph",
        {
          access_token: accessToken,
        },
        {
          scopes: ["Mail.Send"],
          metadata,
          label: "Microsoft Graph Outlook (staging E2E)",
        },
      );

  const agent = await db.agent.findFirst({
    where: { projectId, identifier: agentIdentifier },
    select: { id: true },
  });
  if (!agent) {
    throw new Error(
      `Agent ${agentIdentifier} was not found in project ${projectId}`,
    );
  }

  const assignments = await db.agentAppConnection.findMany({
    where: { agentId: agent.id },
    select: { appConnectionId: true },
  });
  const connectionIds = [
    ...new Set([
      ...assignments.map((assignment) => assignment.appConnectionId),
      connection.id,
    ]),
  ];
  await updateAgentAppConnections(
    projectId,
    agent.id,
    connectionIds.map((appConnectionId) => ({ appConnectionId })),
  );

  console.log(
    JSON.stringify({
      ok: true,
      projectId,
      agentId: agent.id,
      connectionId: connection.id,
      provider: connection.provider,
      status: connection.status,
      token: "stored_encrypted_only",
    }),
  );
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
