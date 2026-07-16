"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BadgeCheck,
  ChevronRight,
  Shield,
  Terminal,
  Users,
  Boxes,
  ClipboardCheck,
  LayoutDashboard,
  Lock,
  Package,
  UserCog,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@onecli/ui/components/dialog";
import { Button } from "@onecli/ui/components/button";
import { Progress } from "@onecli/ui/components/progress";
import { cn } from "@onecli/ui/lib/utils";
import Link from "next/link";
import {
  getProgress,
  markStepComplete,
  type OnboardingStep,
} from "@/lib/onboarding-progress";

interface GetStartedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CHECKLIST_ITEMS: {
  id: OnboardingStep;
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
}[] = [
  {
    id: "invite-users",
    icon: Users,
    title: "Invite users and assign roles",
    description:
      "Add your team and assign Cyber Admin, Manager, or Employee roles.",
    href: "/settings/members",
  },
  {
    id: "review-roles",
    icon: UserCog,
    title: "Review role permissions",
    description: "Confirm each role's access boundaries before going live.",
    href: "/settings/roles",
  },
  {
    id: "package-gate",
    icon: Package,
    title: "Configure package gate",
    description: "Set allowed registries and block-list risky packages.",
    href: "/settings/policy",
  },
  {
    id: "first-sandbox",
    icon: Boxes,
    title: "Boot first governed sandbox",
    description: "Spin up an isolated AI sandbox with your policy applied.",
    href: "/sandboxes",
  },
  {
    id: "approval-policy",
    icon: ClipboardCheck,
    title: "Create manager approval policy",
    description: "Define which agent actions require a manager sign-off.",
    href: "/rules",
  },
  {
    id: "cyber-console",
    icon: Shield,
    title: "Review Cyber console",
    description:
      "Inspect live governance signals, blocked actions, and audit events.",
    href: "/console",
  },
];

const PERSONA_QUICK_STARTS = [
  {
    id: "cyber-admin",
    icon: Shield,
    label: "Cyber Admin",
    description: "Audit log, threat signals, policy controls",
    href: "/console",
    color: "text-rose-500",
  },
  {
    id: "manager",
    icon: ClipboardCheck,
    label: "Manager",
    description: "Review and act on pending approvals",
    href: "/approvals",
    color: "text-amber-500",
  },
  {
    id: "employee",
    icon: Boxes,
    label: "Employee",
    description: "Launch and manage your AI sandboxes",
    href: "/sandboxes",
    color: "text-blue-500",
  },
  {
    id: "platform-owner",
    icon: LayoutDashboard,
    label: "Platform Owner",
    description: "Manage deployed apps and integrations",
    href: "/apps",
    color: "text-violet-500",
  },
] as const;

export const GetStartedDialog = ({
  open,
  onOpenChange,
}: GetStartedDialogProps) => {
  const [completed, setCompleted] = useState<Set<OnboardingStep>>(new Set());
  const [showCli, setShowCli] = useState(false);

  // Hydrate from localStorage once on mount
  useEffect(() => {
    const { completed: saved } = getProgress();
    setCompleted(new Set(saved));
  }, []);

  const toggle = useCallback((id: OnboardingStep) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // Note: we only persist completions, not removals (checklist UX)
      } else {
        next.add(id);
        markStepComplete(id);
      }
      return next;
    });
  }, []);

  const total = CHECKLIST_ITEMS.length;
  const doneCount = completed.size;
  const allDone = doneCount === total;
  const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-xl">Set up ONEComputer</DialogTitle>
          <DialogDescription>
            Govern AI sandboxes, agents, approvals, and enterprise connectors.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-6">
          {/* Progress summary */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {allDone ? (
                  <span className="flex items-center gap-1.5 text-green-600 font-medium">
                    <BadgeCheck className="size-4" />
                    Setup complete
                  </span>
                ) : (
                  <>
                    <span className="font-medium text-foreground">
                      {doneCount}
                    </span>
                    {" of "}
                    <span className="font-medium text-foreground">{total}</span>
                    {" completed"}
                  </>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {progressPct}%
              </span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </section>

          {/* Checklist */}
          <section>
            <h3 className="text-sm font-semibold mb-3 text-foreground">
              Org setup checklist
            </h3>
            <div className="space-y-2">
              {CHECKLIST_ITEMS.map((item) => {
                const Icon = item.icon;
                const done = completed.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                      done
                        ? "border-border bg-muted/40"
                        : "border-border hover:bg-muted/20",
                    )}
                  >
                    <button
                      type="button"
                      aria-label={done ? "Mark incomplete" : "Mark complete"}
                      onClick={() => toggle(item.id)}
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        done
                          ? "border-green-500 bg-green-500 text-white"
                          : "border-muted-foreground/40 hover:border-foreground/60",
                      )}
                    >
                      {done && <BadgeCheck className="size-3.5" />}
                    </button>

                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        done
                          ? "text-muted-foreground/50"
                          : "text-muted-foreground",
                      )}
                    />

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm font-medium leading-none",
                          done && "text-muted-foreground line-through",
                        )}
                      >
                        {item.title}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {item.description}
                      </p>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="shrink-0 text-xs"
                      onClick={() => onOpenChange(false)}
                    >
                      <Link href={item.href}>
                        Open
                        <ChevronRight className="size-3" />
                      </Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Persona quick starts */}
          <section>
            <h3 className="text-sm font-semibold mb-3 text-foreground">
              Persona quick starts
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {PERSONA_QUICK_STARTS.map((persona) => {
                const Icon = persona.icon;
                return (
                  <Link
                    key={persona.id}
                    href={persona.href}
                    onClick={() => onOpenChange(false)}
                    className="flex flex-col gap-1.5 rounded-lg border border-border p-3 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        className={cn("size-3.5 shrink-0", persona.color)}
                      />
                      <p className="text-sm font-medium leading-none">
                        {persona.label}
                      </p>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {persona.description}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Developer CLI — collapsed by default */}
          <section>
            <button
              type="button"
              onClick={() => setShowCli((v) => !v)}
              className="flex w-full items-center gap-2 text-left"
            >
              <Terminal className="text-muted-foreground size-3.5" />
              <span className="text-muted-foreground text-xs font-medium">
                Developer CLI (advanced)
              </span>
              <ChevronRight
                className={cn(
                  "text-muted-foreground ml-auto size-3.5 transition-transform",
                  showCli && "rotate-90",
                )}
              />
            </button>

            {showCli && (
              <div className="mt-2 rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Lock className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                  <p className="text-muted-foreground text-xs">
                    Use the ONEComputer CLI to route coding-agent traffic
                    through the gateway. Install via{" "}
                    <code className="bg-muted rounded px-1 font-mono text-[10px]">
                      onecli run
                    </code>{" "}
                    after obtaining an API key from{" "}
                    <Link
                      href="/settings/api-keys"
                      className="text-foreground underline underline-offset-2"
                      onClick={() => onOpenChange(false)}
                    >
                      Settings → API Keys
                    </Link>
                    .
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};
