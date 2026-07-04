import { redirect } from "next/navigation";

import ChatWorkspace from "@/components/chat/ChatWorkspace";
import { createSupabaseServerClient } from "@/lib/db/supabase";

// Auth-gated grounded RAG chat workspace.
export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <ChatWorkspace userEmail={user.email ?? "signed in"} />;
}
