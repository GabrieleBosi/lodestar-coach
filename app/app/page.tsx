import { redirect } from "next/navigation";

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

  // The dashboard had no link anywhere in the UI — reachable only by typing the
  // path (issue #2, P1). Gated by the same predicate the page itself enforces,
  // so the link can't appear for someone who would be redirected away.
  return <ChatWorkspace userEmail={user.email ?? "signed in"} isAdmin={isAdminEmail(user.email)} />;
}
