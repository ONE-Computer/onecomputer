"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type LucideIcon } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@onecli/ui/components/sidebar";
import { cn } from "@onecli/ui/lib/utils";
import { summary as fetchApprovalSummary } from "@/lib/api/approvals";

const sidebarMenuButtonActiveStyles =
  "font-normal data-[active=true]:bg-brand/10 data-[active=true]:font-medium data-[active=true]:text-brand data-[active=true]:hover:bg-brand/15 dark:data-[active=true]:bg-brand/10 dark:data-[active=true]:text-brand dark:data-[active=true]:hover:bg-brand/15";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  /**
   * When true, the item renders a live count badge sourced from
   * /v1/approvals/summary. Used by the Approvals nav entry to surface the
   * pending-approvals count to the manager without opening the page.
   */
  badge?: boolean;
}

/**
 * A persona-oriented nav section rendered with a small header label. Sections
 * are always visible; the title helps orient each persona.
 */
export interface NavSection {
  title: string;
  items: NavItem[];
}

interface NavMainProps {
  /**
   * Accepted shapes, in order of preference:
   *  - NavSection[]  : sections with header labels (preferred)
   *  - NavItem[][]   : groups separated by dividers, no headers (legacy)
   *  - NavItem[]     : a single flat group (legacy)
   */
  items: NavItem[] | NavItem[][] | NavSection[];
}

const isSectionArray = (items: unknown[]): items is NavSection[] =>
  items.length > 0 &&
  typeof (items[0] as NavSection | undefined) === "object" &&
  "title" in (items[0] as NavSection) &&
  "items" in (items[0] as NavSection);

const isGroupArray = (items: unknown[]): items is NavItem[][] =>
  items.length > 0 && Array.isArray(items[0]);

export const NavMain = ({ items }: NavMainProps) => {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  // Fetch the pending-approvals count for any nav item flagged with `badge`.
  // Polled every 30s so the manager sees new requests without leaving the
  // current page. Failures are silent — the badge simply stays empty.
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const s = await fetchApprovalSummary();
        if (mounted) setPendingCount(s.pending);
      } catch {
        /* keep badge empty on transient error */
      }
    };
    void load();
    const id = setInterval(load, 30000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const isActive = (url: string) => {
    if (url === "/") return pathname === "/";
    return pathname.startsWith(url);
  };

  // Normalize the three accepted shapes into a list of sections (with optional
  // titles). Sections render a header label; untitled groups render a divider.
  let sections: { title?: string; items: NavItem[] }[];
  if (items.length === 0) {
    sections = [];
  } else if (isSectionArray(items as unknown[])) {
    sections = (items as NavSection[]).map((s) => ({
      title: s.title,
      items: s.items,
    }));
  } else if (isGroupArray(items as unknown[])) {
    sections = (items as NavItem[][]).map((group) => ({ items: group }));
  } else {
    sections = [{ items: items as NavItem[] }];
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
      {sections.map((section, i) => (
        <div key={i}>
          {i > 0 && <SidebarSeparator className="my-2" />}
          {section.title ? (
            <SidebarGroupLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider group-data-[collapsible=icon]:sr-only">
              {section.title}
            </SidebarGroupLabel>
          ) : null}
          <SidebarMenu>
            {section.items.map((item) => (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(item.url)}
                  tooltip={item.title}
                  className={cn(sidebarMenuButtonActiveStyles)}
                >
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                    {item.badge && pendingCount && pendingCount > 0 ? (
                      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-medium text-white group-data-[collapsible=icon]:hidden">
                        {pendingCount > 99 ? "99+" : pendingCount}
                      </span>
                    ) : null}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </div>
      ))}
    </SidebarGroup>
  );
};
