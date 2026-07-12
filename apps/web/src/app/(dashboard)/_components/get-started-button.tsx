"use client";

import { useState, useEffect } from "react";
import { Rocket, BadgeCheck } from "lucide-react";
import { Button } from "@onecli/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@onecli/ui/components/tooltip";
import { GetStartedDialog } from "./get-started-dialog";
import { getProgress } from "@/lib/onboarding-progress";

const TOTAL_STEPS = 6;

export const GetStartedButton = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  // Sync count whenever dialog closes (steps may have been marked)
  const handleOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setCompletedCount(getProgress().completed.length);
    }
  };

  // Hydrate on mount
  useEffect(() => {
    setCompletedCount(getProgress().completed.length);
  }, []);

  const allDone = completedCount >= TOTAL_STEPS;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={allDone ? "outline" : "brand"}
            size="sm"
            onClick={() => setDialogOpen(true)}
          >
            {allDone ? (
              <BadgeCheck className="size-3.5 text-green-600" />
            ) : (
              <Rocket className="size-3.5" />
            )}
            {allDone ? "Setup Complete" : "Get Started"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {allDone
            ? "All setup steps complete"
            : "Set up ONEComputer for your org"}
        </TooltipContent>
      </Tooltip>
      <GetStartedDialog open={dialogOpen} onOpenChange={handleOpenChange} />
    </>
  );
};
