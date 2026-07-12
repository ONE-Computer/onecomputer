export const STATE_BADGE: Record<string, { label: string; className: string }> =
  {
    started: {
      label: "Running",
      className: "bg-green-500/15 text-green-700 dark:text-green-400",
    },
    creating: {
      label: "Starting…",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    },
    stopped: {
      label: "Stopped",
      className: "bg-muted text-muted-foreground",
    },
    archived: {
      label: "Archived",
      className: "bg-muted text-muted-foreground",
    },
    error: {
      label: "Error",
      className: "bg-destructive/15 text-destructive",
    },
  };

export const StateBadge = ({ state }: { state: string }) => {
  const cfg = STATE_BADGE[state] ?? STATE_BADGE["stopped"]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      {state === "creating" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {cfg.label}
    </span>
  );
};
