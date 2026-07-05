import { redirect } from "next/navigation";

import ProfileForm from "@/components/ProfileForm";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <ProfileForm />;
}
