import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ok } from "@/lib/supabase-helpers";
import type { Database } from "@/integrations/supabase/types";
import { APP_ROLES, ROLE_LABELS, ROLE_SUMMARY, type AppRole } from "@/lib/roles-core";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export const Route = createFileRoute("/_authenticated/users")({
  component: UsersPage,
});

function UsersPage() {
  const { hasRole } = useAuth();
  const [profiles, setProfiles] = useState<(Profile & { user_roles?: { role: string }[] })[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("field_officer");

  const loadUsers = async () => {
    const { data: profilesData } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    const { data: rolesData } = await supabase.from("user_roles").select("user_id, role");
    const combined = (profilesData || []).map((p) => ({
      ...p,
      user_roles: (rolesData || []).filter((r) => r.user_id === p.user_id).map((r) => ({ role: r.role })),
    }));
    setProfiles(combined);
  };

  useEffect(() => { loadUsers(); }, []);

  if (!hasRole("admin")) {
    return <div className="text-muted-foreground">Admin access required.</div>;
  }

  const handleChangeRole = async (userId: string, newRole: string) => {
    const { error: delError } = await supabase.from("user_roles").delete().eq("user_id", userId);
    if (!ok(delError, "Change role")) return;
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole as Database["public"]["Enums"]["app_role"] });
    if (!ok(error, "Change role")) return;
    toast.success("Role updated");
    loadUsers();
  };

  const handleToggleActive = async (profile: Profile) => {
    const { error } = await supabase.from("profiles").update({ active_status: !profile.active_status }).eq("id", profile.id);
    if (!ok(error, "Update user")) return;
    loadUsers();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-1" />Invite User</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.full_name || "—"}</TableCell>
                  <TableCell>{p.email}</TableCell>
                  <TableCell>
                    <Select
                      value={p.user_roles?.[0]?.role}
                      onValueChange={(v) => handleChangeRole(p.user_id, v)}
                    >
                      <SelectTrigger className="w-44" title={p.user_roles?.[0]?.role ? ROLE_SUMMARY[p.user_roles[0].role as AppRole] : "Without a role this account can see nothing."}>
                        <SelectValue placeholder="No role (sees nothing)" />
                      </SelectTrigger>
                      <SelectContent>
                        {APP_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={p.active_status ? "bg-chart-2/10 text-chart-2" : "bg-muted text-muted-foreground"}>
                      {p.active_status ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => handleToggleActive(p)}>
                      {p.active_status ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite User</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              To invite a user, have them sign up at the login page, then assign their role here.
            </p>
            <Button onClick={() => setDialogOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
