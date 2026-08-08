import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import ChatWorkspace from "@/components/chat/ChatWorkspace";
import { isAdminEmail } from "@/lib/auth/admin";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export const metadata = { title: "Chat" };

// Auth-gated grounded RAG chat workspace.
export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Metrics stays gated by the same predicate the page itself enforces, so the
  // tab can't appear for someone who would be redirected away (issue #2, P1).
  const isAdmin = isAdminEmail(user.email);
  return (
    <AppShell userEmail={user.email ?? "signed in"} active="Chat" isAdmin={isAdmin}>
      <ChatWorkspace isAdmin={isAdmin} />
    </AppShell>
  );
}
