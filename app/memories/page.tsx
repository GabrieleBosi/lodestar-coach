import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import MemoriesView from "@/components/MemoriesView";
import { isAdminEmail } from "@/lib/auth/admin";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export const metadata = { title: "Memory" };

export default async function MemoriesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <AppShell
      userEmail={user.email ?? "signed in"}
      active="Memory"
      isAdmin={isAdminEmail(user.email)}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MemoriesView />
      </div>
    </AppShell>
  );
}
