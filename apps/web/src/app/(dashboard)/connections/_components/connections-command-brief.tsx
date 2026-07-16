import { DatabaseZap, KeyRound, LockKeyhole, Network } from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Card } from "@onecli/ui/components/card";

export const ConnectionsCommandBrief = () => {
  const lanes = [
    {
      title: "Connector custody",
      description:
        "OAuth apps, API keys, LLM keys, and vaults are governed as brokered resources, not copied into agent prompts.",
      icon: Network,
    },
    {
      title: "Secret injection",
      description:
        "Credentials are resolved at request time through the gateway with host/path policy boundaries.",
      icon: KeyRound,
    },
    {
      title: "External vaults",
      description:
        "1Password and Bitwarden integrations keep long-lived secrets under enterprise vault ownership.",
      icon: DatabaseZap,
    },
    {
      title: "Least privilege",
      description:
        "App permissions and rules decide what each agent can access before tool execution.",
      icon: LockKeyhole,
    },
  ];

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Network className="size-4 text-brand" />
            <h2 className="text-sm font-semibold">Connector risk surface</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            For a CISO review, this tab should prove that agent access to bank
            systems is brokered, scoped, revocable, and auditable.
          </p>
        </div>
        <Badge variant="outline">Credential governance</Badge>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {lanes.map((lane) => (
          <div key={lane.title} className="rounded-lg border bg-muted/20 p-3">
            <lane.icon className="size-4 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{lane.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {lane.description}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
};
