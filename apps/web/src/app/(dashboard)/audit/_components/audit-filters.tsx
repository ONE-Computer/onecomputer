"use client";

import { Input } from "@onecli/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@onecli/ui/components/select";
import type { TimelineKind } from "@/lib/api/audit";

export type TimeRange = "24h" | "7d" | "30d";

export interface AuditFiltersState {
  range: TimeRange;
  kind: TimelineKind | "all";
  agentId: string;
  query: string;
}

interface AuditFiltersProps {
  value: AuditFiltersState;
  onChange: (next: AuditFiltersState) => void;
}

const RANGE_LABELS: Record<TimeRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

const KIND_LABELS: Record<TimelineKind, string> = {
  gateway: "Gateway",
  admin: "Admin",
  approval: "Approval",
};

export const AuditFilters = ({ value, onChange }: AuditFiltersProps) => {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.range}
        onValueChange={(range: TimeRange) => onChange({ ...value, range })}
      >
        <SelectTrigger size="sm" className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(RANGE_LABELS).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.kind}
        onValueChange={(kind: TimelineKind | "all") =>
          onChange({ ...value, kind })
        }
      >
        <SelectTrigger size="sm" className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All kinds</SelectItem>
          {Object.entries(KIND_LABELS).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        placeholder="Agent ID"
        value={value.agentId}
        onChange={(e) => onChange({ ...value, agentId: e.target.value })}
        className="h-8 w-[140px]"
      />

      <Input
        placeholder="Search summary…"
        value={value.query}
        onChange={(e) => onChange({ ...value, query: e.target.value })}
        className="h-8 w-[220px]"
      />
    </div>
  );
};
