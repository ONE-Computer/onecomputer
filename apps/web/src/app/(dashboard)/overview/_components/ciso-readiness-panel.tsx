import { ShieldCheck } from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Card } from "@onecli/ui/components/card";

type Status = "done" | "in_progress" | "not_built";

interface ControlStatus {
  label: string;
  detail: string;
  status: Status;
}

const STATUS_META: Record<
  Status,
  { icon: string; tone: "secondary" | "outline"; verb: string }
> = {
  done: { icon: "✅", tone: "secondary", verb: "Done" },
  in_progress: { icon: "🟡", tone: "outline", verb: "In progress" },
  not_built: { icon: "❌", tone: "outline", verb: "Not built" },
};

// Static, honest readiness snapshot — no fake percentages or counts. Each
// line maps to a real build state in the OneComputer roadmap.
const controls: ControlStatus[] = [
  {
    label: "Gateway enforcement",
    detail: "4/4 gaps compiled",
    status: "done",
  },
  {
    label: "RBAC",
    detail: "@casl wired to routes",
    status: "done",
  },
  {
    label: "VTI identity",
    detail: "In progress (Phase I)",
    status: "in_progress",
  },
  {
    label: "Verdaccio package gate",
    detail: "In progress (Sprint G)",
    status: "in_progress",
  },
  {
    label: "SharePoint connector",
    detail: "Not built",
    status: "not_built",
  },
];

export const CisoReadinessPanel = () => {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-brand" />
        <h2 className="text-sm font-semibold">Control readiness</h2>
      </div>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
        Honest build status of each control surface — no fabricated scores.
      </p>

      <ul className="mt-4 divide-y rounded-lg border">
        {controls.map((control) => {
          const meta = STATUS_META[control.status];
          return (
            <li
              key={control.label}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="flex items-center gap-2">
                <span aria-hidden>{meta.icon}</span>
                <div>
                  <p className="text-sm font-medium">{control.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {control.detail}
                  </p>
                </div>
              </div>
              <Badge variant={meta.tone}>{meta.verb}</Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
