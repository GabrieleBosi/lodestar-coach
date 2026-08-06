import { redirect } from "next/navigation";

import MetricsDashboard from "@/components/MetricsDashboard";
import { isAdminEmail } from "@/lib/auth/admin";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export const metadata = { title: "Metrics" };

// Admin-only metrics dashboard.
export default async function MetricsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/app");

  return <MetricsDashboard />;
}
