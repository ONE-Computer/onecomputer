"use client";

import * as React from "react";
import Link from "next/link";
import { Cpu } from "lucide-react";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import { navSections } from "@/lib/nav-config";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@onecli/ui/components/sidebar";

export const DashboardSidebar = ({
  ...props
}: React.ComponentProps<typeof Sidebar>) => {
  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader className="h-12 justify-center group-data-[collapsible=icon]:px-0">
        <Link href="/" className="flex items-center gap-2 px-2">
          <span className="flex size-7 items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand">
            <Cpu className="size-4" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            OneComputer
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navSections} />
      </SidebarContent>
      <SidebarFooter className="justify-center group-data-[collapsible=icon]:px-0">
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
};
