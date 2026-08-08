import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import ProfileForm from "@/components/ProfileForm";
import { isAdminEmail } from "@/lib/auth/admin";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell
      userEmail={user.email ?? "signed in"}
      active="Profile"
      isAdmin={isAdminEmail(user.email)}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProfileForm />
      </div>
    </AppShell>
  );
}
