import { redirect } from "next/navigation";

import MemoriesView from "@/components/MemoriesView";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export default async function MemoriesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <MemoriesView />;
}
