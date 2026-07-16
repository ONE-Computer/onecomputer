"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Info, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@onecli/ui/components/card";
import { Button } from "@onecli/ui/components/button";
import { Badge } from "@onecli/ui/components/badge";
import { Input } from "@onecli/ui/components/input";
import { Label } from "@onecli/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@onecli/ui/components/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@onecli/ui/components/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@onecli/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@onecli/ui/components/table";
import { members, type Member, type OrgRole } from "@/lib/api";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner/Platform",
  admin: "Cyber Admin",
  manager: "Manager",
  member: "Employee",
};

// Roles selectable when inviting or reassigning. Owner is excluded — owner
// transfer isn't supported by this UI, matching the server's guard that only
// an existing owner may grant the owner role.
const ASSIGNABLE_ROLES: OrgRole[] = ["admin", "manager", "member"];

const membersQueryKey = ["members", "list"] as const;

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const InviteMemberDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);
  const { copied, copy } = useCopyToClipboard();
  const qc = useQueryClient();

  const inviteMutation = useMutation({
    mutationFn: () => members.invite(email.trim(), role),
    onSuccess: (result) => {
      setInvitationUrl(result.invitationUrl);
      qc.invalidateQueries({ queryKey: membersQueryKey });
      toast.success("Invitation created");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create invitation");
    },
  });

  const isValidEmail = /\S+@\S+\.\S+/.test(email.trim());

  const handleClose = (value: boolean) => {
    if (!value) {
      setEmail("");
      setRole("member");
      setInvitationUrl(null);
    }
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        {invitationUrl ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation created</DialogTitle>
              <DialogDescription>
                Share this link with the invited user to let them join the
                organization.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <div className="bg-muted flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
                <code className="min-w-0 truncate font-mono text-xs">
                  {invitationUrl}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => copy(invitationUrl)}
                >
                  {copied ? (
                    <Check className="size-3.5 text-brand" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)} className="w-full">
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite user</DialogTitle>
              <DialogDescription>
                Invite a user to your organization and assign their role.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as OrgRole)}
                >
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => inviteMutation.mutate()}
                loading={inviteMutation.isPending}
                disabled={!isValidEmail || inviteMutation.isPending}
              >
                {inviteMutation.isPending ? "Inviting..." : "Invite"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const MemberRow = ({ member }: { member: Member }) => {
  const qc = useQueryClient();
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  const updateRoleMutation = useMutation({
    mutationFn: (role: OrgRole) => members.updateRole(member.userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersQueryKey });
      toast.success("Role updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update role");
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => members.remove(member.userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersQueryKey });
      toast.success("Member removed");
      setRemoveDialogOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to remove member");
    },
  });

  const roleOptions =
    member.role === "owner"
      ? (["owner", ...ASSIGNABLE_ROLES] as OrgRole[])
      : ASSIGNABLE_ROLES;

  return (
    <TableRow>
      <TableCell className="font-medium">{member.userEmail}</TableCell>
      <TableCell>
        <Select
          value={member.role}
          onValueChange={(value) => {
            if (value === member.role) return;
            updateRoleMutation.mutate(value as OrgRole);
          }}
          disabled={updateRoleMutation.isPending}
        >
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue>
              <Badge
                variant={member.role === "owner" ? "default" : "secondary"}
              >
                {ROLE_LABELS[member.role]}
              </Badge>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(member.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setRemoveDialogOpen(true)}
          >
            Remove
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove member?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>{member.userEmail}</strong> will lose access to this
                organization immediately. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={(e) => {
                  e.preventDefault();
                  removeMutation.mutate();
                }}
                disabled={removeMutation.isPending}
              >
                {removeMutation.isPending ? "Removing..." : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
};

export const MembersContent = () => {
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data: memberList = [], isPending } = useQuery({
    queryKey: membersQueryKey,
    queryFn: members.list,
  });

  const sortedMembers = useMemo(
    () =>
      [...memberList].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [memberList],
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Members</CardTitle>
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" />
            Invite user
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4 text-xs">
            Local dev runs as Admin; invited users are persisted but email
            delivery is not configured.
          </p>
          {isPending ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Loading members...
            </p>
          ) : sortedMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-medium">No members yet</p>
              <p className="text-muted-foreground mt-1 mb-4 text-xs">
                Invite your first user to get started.
              </p>
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" />
                Invite user
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMembers.map((member) => (
                  <MemberRow key={member.userId} member={member} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      {/* Team policy shortcut */}
      <div className="flex items-start gap-3 rounded-md border px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
        <div className="flex-1 space-y-1">
          <p className="font-medium">Set a Team (project) policy</p>
          <p className="text-muted-foreground text-xs">
            Enterprise policies set the floor. Teams can only add stricter
            controls, never weaker ones. Go to{" "}
            <Link
              href="/rules"
              className="text-brand underline-offset-2 hover:underline"
            >
              Rules
            </Link>{" "}
            and select <strong>Team</strong> as the Level when creating a rule.
          </p>
        </div>
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      </div>
    </>
  );
};
