"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onecli/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@onecli/ui/components/select";
import {
  getLandingPage,
  getPersonaRole,
  setPersonaRole,
  type PersonaRole,
} from "@/lib/role-preference";

const PERSONAS: { value: PersonaRole; label: string }[] = [
  { value: "admin", label: "Admin (Cyber)" },
  { value: "manager", label: "Manager" },
  { value: "member", label: "Employee" },
  { value: "owner", label: "Owner (Platform)" },
];

export const PersonaSwitcher = () => {
  const router = useRouter();
  const [role, setRole] = useState<PersonaRole>("admin");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setRole(getPersonaRole());
    setMounted(true);
  }, []);

  const handleChange = (value: string) => {
    const next = value as PersonaRole;
    setRole(next);
    setPersonaRole(next);
    router.push(getLandingPage(next));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Persona preview</CardTitle>
        <CardDescription>
          Preview the dashboard as a different persona. In production this will
          be set by your org role. This is for preview only.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2">
          <span className="text-sm font-medium">Preview as persona</span>
          <Select
            value={mounted ? role : undefined}
            onValueChange={handleChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select persona" />
            </SelectTrigger>
            <SelectContent>
              {PERSONAS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
};
