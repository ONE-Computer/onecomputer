import { Card } from "@onecli/ui/components/card";

export default function AppsLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <div className="h-8 w-44 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <Card className="h-56 animate-pulse bg-muted/40" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="h-28 animate-pulse bg-muted/40" />
        ))}
      </div>
    </div>
  );
}
