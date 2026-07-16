"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, Loader2, LogOut } from "lucide-react";

import pkg from "../../../../../../package.json";
import { useAuth } from "@/providers/auth-provider";
import { getPersonaRole, type PersonaRole } from "@/lib/role-preference";
import { Avatar, AvatarFallback } from "@onecli/ui/components/avatar";
import { Badge } from "@onecli/ui/components/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@onecli/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@onecli/ui/components/sidebar";

// Local dev has no real org role on the session, so the badge reflects the
// persona preview stored in localStorage (see profile > persona switcher).
// The (local) suffix makes clear this isn't a real assigned role.
const ROLE_BADGE_LABEL: Record<PersonaRole, string> = {
  owner: "Owner/Platform (local)",
  admin: "Cyber Admin (local)",
  manager: "Manager (local)",
  member: "Employee (local)",
};

export const NavUser = () => {
  const { isMobile } = useSidebar();
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [roleLabel, setRoleLabel] = useState(ROLE_BADGE_LABEL.admin);

  useEffect(() => {
    setRoleLabel(ROLE_BADGE_LABEL[getPersonaRole()]);
  }, []);

  const displayName = user?.name ?? user?.email ?? "User";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs">{user?.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "bottom" : "top"}
            align="end"
            sideOffset={4}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium leading-none">
                    {displayName}
                  </p>
                  <span className="text-muted-foreground text-[10px]">
                    v{pkg.version}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs leading-none">
                  {user?.email}
                </p>
                <Badge variant="secondary" className="mt-1 w-fit">
                  {roleLabel}
                </Badge>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                await signOut();
              }}
            >
              {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
              {signingOut ? "Signing out..." : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};
