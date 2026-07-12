"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@onecli/ui/components/card";
import { Button } from "@onecli/ui/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@onecli/ui/components/alert-dialog";
import { useIsOwner } from "@/hooks/use-persona-role";
import { resetDemoData } from "@/lib/actions/demo";

/**
 * Owner-only, local/demo-mode-only card that wipes and reseeds the "Demo
 * Corp" namespace. Only rendered by the parent page when
 * `getAuthMode() !== "cloud"` — this component additionally gates on the
 * simulated Owner persona so Manager/Employee/Cyber personas never see it,
 * matching the rest of the app's local-mode persona-gating pattern.
 *
 * The real safety boundary is server-side (DEMO_MODE_ENABLED in the
 * `resetDemoData` server action) — this component is UX only.
 */
export const ResetDemoDataCard = () => {
  const isOwner = useIsOwner();
  const [open, setOpen] = useState(false);

  const resetMutation = useMutation({
    mutationFn: resetDemoData,
    onSuccess: () => {
      toast.success("Demo data reset", {
        description: "Demo Corp has been wiped and reseeded.",
      });
      setOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to reset demo data");
    },
  });

  if (!isOwner) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset demo data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Deletes every row in the &quot;Demo Corp&quot; namespace (org,
          members, project, policies, agent, and the seeded blocked-install and
          pending-approval story events) and reseeds it from scratch. Never
          touches any other organization.
        </p>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setOpen(true)}
          >
            <RotateCcw className="size-4" />
            Reset demo data
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Demo Corp?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes all Demo Corp data (org, members, project,
                policies, agent, blocked-install log, pending approval) and
                reseeds it from a clean slate. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={(e) => {
                  e.preventDefault();
                  resetMutation.mutate();
                }}
                disabled={resetMutation.isPending}
              >
                {resetMutation.isPending ? "Resetting..." : "Reset demo data"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};
