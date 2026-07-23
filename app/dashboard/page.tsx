import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: tracks } = await supabase
    .from("tracks")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <DashboardClient
      userEmail={user.email ?? ""}
      isPro={profile?.subscription_status === "active"}
      usageCount={profile?.usage_count_this_month ?? 0}
      initialTracks={tracks ?? []}
    />
  );
}
