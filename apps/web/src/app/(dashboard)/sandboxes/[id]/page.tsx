import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { SandboxInfo } from "@/lib/api/sandboxes";
import { SandboxDetail } from "./_components/sandbox-detail";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ?? "http://localhost:10256";

async function fetchSandbox(
  id: string,
  persona?: string,
): Promise<SandboxInfo | null> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/v1/sandboxes/${id}`, {
      cache: "no-store",
      headers: persona ? { "x-onecomputer-persona": persona } : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as SandboxInfo;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sandbox = await fetchSandbox(id);
  return { title: sandbox ? `Sandbox: ${sandbox.name}` : "Sandbox" };
}

export default async function SandboxDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ persona?: string }>;
}) {
  const { id } = await params;
  const { persona } = await searchParams;
  const sandbox = await fetchSandbox(id, persona);
  if (!sandbox) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <SandboxDetail sandbox={sandbox} />
    </div>
  );
}
