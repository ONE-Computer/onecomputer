import {
  LayoutDashboard,
  Bot,
  Shield,
  Settings,
  Plug,
  Activity,
  User,
  KeyRound,
  ShieldCheck,
  Globe,
  MonitorCog,
  BrainCircuit,
  ClipboardCheck,
  Terminal,
  CheckCircle,
  Users,
  ShieldQuestion,
  ScrollText,
} from "lucide-react";
import type { NavItem } from "@/app/(dashboard)/_components/nav-main";

export interface SettingsNavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface SettingsNavSection {
  label: string;
  items: SettingsNavItem[];
}

/**
 * A persona-oriented nav section. Sections are always visible; the section
 * title helps orient each persona (Cyber, Manager, Employee, Platform) without
 * hiding items that fall outside their north star.
 *
 * North stars:
 *  - Cyber (admin/owner): Monitoring — console, kill switch
 *  - Manager: Governance — approvals queue, team summary
 *  - Employee (member): Workspace — boot and run agents
 *  - Platform (owner in deploy mode): Monitoring — deploy wizard (apps)
 */
export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { title: "Sandboxes", url: "/sandboxes", icon: Terminal },
      { title: "Agent Control", url: "/agents", icon: Bot },
      { title: "Connections", url: "/connections", icon: Plug },
      { title: "Copilot", url: "/copilot", icon: BrainCircuit },
    ],
  },
  {
    title: "Governance",
    items: [
      { title: "Approvals", url: "/approvals", icon: CheckCircle, badge: true },
      { title: "Rules", url: "/rules", icon: Shield },
      { title: "Activity", url: "/activity", icon: Activity },
    ],
  },
  {
    title: "Monitoring",
    items: [
      { title: "CISO Console", url: "/console", icon: ClipboardCheck },
      { title: "Audit Timeline", url: "/audit", icon: ScrollText },
      { title: "LLM Traces", url: "/llm-traces", icon: BrainCircuit },
      { title: "Computer Control", url: "/apps", icon: MonitorCog },
    ],
  },
  {
    title: "System",
    items: [
      { title: "Overview", url: "/overview", icon: LayoutDashboard },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

/**
 * Flat list of all nav items, preserved for any caller that still expects a
 * flat array (e.g. mobile nav, search). Derived from navSections so the two
 * representations can never drift.
 */
export const navItems: NavItem[] = navSections.flatMap((s) => s.items);

export const getSettingsSections = (
  // Cloud override uses orgId to prefix URLs with /org/<id>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  orgId?: string,
): SettingsNavSection[] => [
  {
    label: "General",
    items: [{ title: "Instance", url: "/settings/instance", icon: Globe }],
  },
  {
    label: "Account",
    items: [
      { title: "Profile", url: "/settings/profile", icon: User },
      { title: "API Keys", url: "/settings/api-keys", icon: KeyRound },
    ],
  },
  {
    label: "Organization",
    items: [
      { title: "Members", url: "/settings/members", icon: Users },
      { title: "Roles", url: "/settings/roles", icon: ShieldQuestion },
    ],
  },
  {
    label: "Security",
    items: [
      { title: "Policy", url: "/settings/policy", icon: Shield },
      { title: "Encryption", url: "/settings/encryption", icon: ShieldCheck },
    ],
  },
];

export const settingsSections = getSettingsSections();
