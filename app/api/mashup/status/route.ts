import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { checkSplitStatus } from "@/lib/lalal/client";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const mashupId = request.nextUrl.searchParams.get("mashupId");
  if (!mashupId) {
    return NextResponse.json({ error: "mashupId required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: mashup, error } = await admin
    .from("mashups")
    .select("*")
    .eq("id", mashupId)
    .eq("user_id", user.id)
    .single();

  if (error || !mashup) {
    return NextResponse.json({ error: "Mashup not found" }, { status: 404 });
  }

  if (mashup.status === "done" && mashup.result_storage_path) {
    try {
      const parsed = JSON.parse(mashup.result_storage_path);
      return NextResponse.json({ status: "done", ...parsed });
    } catch {
      // fall through and re-check with LALAL
    }
  }

  if (mashup.status === "failed") {
    return NextResponse.json({
      status: "failed",
      error: mashup.result_storage_path || "Mashup failed",
    });
  }

  if (!mashup.lalal_task_id) {
    return NextResponse.json({ status: "processing" });
  }

  const [fileIdA, fileIdB] = String(mashup.lalal_task_id).split(":");

  try {
    const [resultA, resultB] = await Promise.all([
      checkSplitStatus(fileIdA),
      checkSplitStatus(fileIdB),
    ]);

    if (resultA?.status === "error" || resultB?.status === "error") {
      const message = resultA?.error || resultB?.error || "LALAL split failed";
      await admin
        .from("mashups")
        .update({ status: "failed", result_storage_path: message })
        .eq("id", mashupId);
      return NextResponse.json({ status: "failed", error: message });
    }

    const instrumentalUrl = resultA?.split?.back_track;
    const vocalsUrl = resultB?.split?.stem_track;

    if (resultA?.status === "success" && resultB?.status === "success" && instrumentalUrl && vocalsUrl) {
      const payload = { instrumentalUrl, vocalsUrl };
      await admin
        .from("mashups")
        .update({ status: "done", result_storage_path: JSON.stringify(payload) })
        .eq("id", mashupId);
      return NextResponse.json({ status: "done", ...payload });
    }

    return NextResponse.json({ status: "processing" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Status check failed";
    return NextResponse.json({ status: "processing", note: message });
  }
}
