"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Button } from "@onecli/ui/components/button";
import { Badge } from "@onecli/ui/components/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@onecli/ui/components/tooltip";
import { cn } from "@onecli/ui/lib/utils";
import type { OrgRole } from "@onecli/api/lib/ability";

// ---------------------------------------------------------------------------
// Role label map — persona language per spec
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Cyber Admin",
  manager: "Manager",
  member: "Employee",
};

// Badge colour per role
const ROLE_BADGE_VARIANT: Record<
  OrgRole,
  "default" | "secondary" | "destructive" | "outline"
> = {
  owner: "default",
  admin: "destructive",
  manager: "secondary",
  member: "outline",
};

// ---------------------------------------------------------------------------
// PermissionHint
// ---------------------------------------------------------------------------

export interface PermissionHintProps {
  /** Human-readable reason why the action is gated. */
  reason?: string;
  /** Minimum role required. When provided, generates a canonical reason if
   *  `reason` is omitted. */
  requiredRole?: OrgRole;
  className?: string;
}

/**
 * Small muted inline text with a lock icon that explains a permission
 * requirement.
 *
 * Examples:
 *   <PermissionHint requiredRole="admin" />
 *   → "Requires Cyber Admin"
 *
 *   <PermissionHint requiredRole="manager" reason="Manager approval required" />
 *   → "Manager approval required"
 */
export function PermissionHint({
  reason,
  requiredRole,
  className,
}: PermissionHintProps) {
  const label =
    reason ??
    (requiredRole != null ? `Requires ${ROLE_LABELS[requiredRole]}` : null);

  if (!label) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <Lock className="size-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// DisabledActionButton
// ---------------------------------------------------------------------------

export interface DisabledActionButtonProps extends React.ComponentProps<
  typeof Button
> {
  /** Tooltip message explaining why the action is unavailable. */
  reason: string;
}

/**
 * A disabled Button that shows a tooltip on hover explaining why the action
 * is blocked.
 *
 * All standard Button props are forwarded; `disabled` is always true.
 *
 * Example:
 *   <DisabledActionButton reason="Requires Cyber Admin to delete policies">
 *     Delete Policy
 *   </DisabledActionButton>
 */
export function DisabledActionButton({
  reason,
  children,
  className,
  ...buttonProps
}: DisabledActionButtonProps) {
  return (
    <Tooltip>
      {/*
       * Radix Tooltip does not show on disabled elements by default because
       * disabled elements do not fire pointer events. We wrap in a <span>
       * so the trigger always receives pointer events.
       */}
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn("inline-flex cursor-not-allowed", className)}
          aria-label={reason}
        >
          <Button {...buttonProps} disabled className="pointer-events-none">
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// RoleRequirementBadge
// ---------------------------------------------------------------------------

export interface RoleRequirementBadgeProps {
  role: OrgRole;
  className?: string;
}

/**
 * Badge that names the role required for an action, using persona language.
 *
 * Labels:
 *   owner   → "Owner"
 *   admin   → "Cyber Admin"
 *   manager → "Manager"
 *   member  → "Employee"
 */
export function RoleRequirementBadge({
  role,
  className,
}: RoleRequirementBadgeProps) {
  return (
    <Badge
      variant={ROLE_BADGE_VARIANT[role]}
      className={className}
      aria-label={`Required role: ${ROLE_LABELS[role]}`}
    >
      {ROLE_LABELS[role]}
    </Badge>
  );
}
