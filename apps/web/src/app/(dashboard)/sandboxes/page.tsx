import type { Metadata } from "next";
import type { SandboxInfo } from "@/lib/api/sandboxes";
import { SandboxesContent } from "./_components/sandboxes-content";

export const metadata: Metadata = {
  title: "Sandboxes",
};

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ?? "http://localhost:10256";

async function fetchSandboxes(persona?: string): Promise<SandboxInfo[]> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/v1/sandboxes`, {
      cache: "no-store",
      headers: persona ? { "x-onecomputer-persona": persona } : undefined,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as SandboxInfo[];
    return Array.isArray(data) ? data : [];
  } catch {
    // Daytona unreachable — graceful degradation to empty list
    return [];
  }
}

export default async function SandboxesPage({
  searchParams,
}: {
  searchParams: Promise<{ persona?: string }>;
}) {
  const { persona } = await searchParams;
  const initial = await fetchSandboxes(persona);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <SandboxesContent initialSandboxes={initial} />
    </div>
  );
}
