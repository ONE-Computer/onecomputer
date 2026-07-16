"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@onecli/ui/components/sheet";
import { Badge } from "@onecli/ui/components/badge";
import { withProjectPrefix } from "@/lib/navigation";
import { kindStyleFor, summaryFor } from "./audit-event-row";
import type { TimelineEvent } from "@/lib/api/audit";

interface AuditDetailSheetProps {
  event: TimelineEvent | null;
  onClose: () => void;
}

// Full raw record, pretty-printed — this is the "evidence" view a defensible
// audit trail needs: the human summary is a convenience, the JSON below it is
// the record of record. Approval rows additionally link to the device
// approval page (phase-15a) and surface the VTI taskHash when present.
export const AuditDetailSheet = ({ event, onClose }: AuditDetailSheetProps) => {
  const pathname = usePathname();

  return (
    <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        {event && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="gap-1.5 capitalize"
                  style={{ borderColor: "transparent" }}
                >
                  <span
                    className={`size-2 rounded-full ${kindStyleFor(event.kind).dot}`}
                  />
                  {event.kind}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(event.ts).toLocaleString()}
                </span>
              </div>
              <SheetTitle className="text-base">{summaryFor(event)}</SheetTitle>
              <SheetDescription>
                Evidence record — full raw data below.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
              {event.kind === "approval" && (
                <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                  <Link
                    href={withProjectPrefix(
                      pathname,
                      `/device/approvals/${event.id}`,
                    )}
                    className="font-medium text-brand underline underline-offset-4"
                  >
                    Open approval detail →
                  </Link>
                  {event.vtiTaskHash && (
                    <div className="text-xs text-muted-foreground">
                      <span className="text-foreground/70">
                        VTI task hash:{" "}
                      </span>
                      <span className="font-mono break-all">
                        {event.vtiTaskHash}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Raw record
                </span>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(event, null, 2)}
                </pre>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
