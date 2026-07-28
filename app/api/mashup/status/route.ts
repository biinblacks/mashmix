import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { checkSplitStatuses } from "@/lib/lalal/client";

// Downloading two stems from LALAL and storing them can take a while
export const maxDuration = 300;

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
      return NextResponse.json({ status: "done", ...JSON.parse(mashup.result_storage_path) });
    } catch {
      // stored value wasn't the expected payload; fall through and re-check
    }
  }

  if (mashup.status === "failed") {
    return NextResponse.json({
      status: "failed",
      error: mashup.result_storage_path || "Mashup failed",
    });
  }

  if (!mashup.lalal_task_id) {
    return NextResponse.json({ status: "processing", progress: 0 });
  }

  const [fileIdA, fileIdB] = String(mashup.lalal_task_id).split(":");

  const raw = await checkSplitStatuses([fileIdA, fileIdB]);

  // Persist the raw response so a job stays diagnosable even with no tab open
  await admin
    .from("mashups")
    .update({ debug_info: { raw, checkedAt: new Date().toISOString() } })
    .eq("id", mashupId);

  if (raw.status !== "success" || !raw.result) {
    const message = raw.error || "LALAL check failed";
    await admin
      .from("mashups")
      .update({ status: "failed", result_storage_path: message })
      .eq("id", mashupId);
    return NextResponse.json({ status: "failed", error: message });
  }

  const a = raw.result[fileIdA];
  const b = raw.result[fileIdB];

  const failure =
    a?.task?.state === "error" || a?.task?.state === "cancelled"
      ? a.task.error || `Track A ${a.task.state}`
      : b?.task?.state === "error" || b?.task?.state === "cancelled"
      ? b.task.error || `Track B ${b.task.state}`
      : a?.status === "error"
      ? a.error || "Track A errored"
      : b?.status === "error"
      ? b.error || "Track B errored"
      : null;

  if (failure) {
    await admin
      .from("mashups")
      .update({ status: "failed", result_storage_path: failure })
      .eq("id", mashupId);
    return NextResponse.json({ status: "failed", error: failure });
  }

  // Track A contributes the instrumental, track B contributes the vocals
  const instrumentalUrl = a?.split?.back_track;
  const vocalsUrl = b?.split?.stem_track;

  if (
    a?.task?.state === "success" &&
    b?.task?.state === "success" &&
    instrumentalUrl &&
    vocalsUrl
  ) {
    // Copy both stems into our own storage. LALAL's URLs expire and aren't
    // CORS-accessible from the browser, and the mixing step needs to read the
    // raw audio bytes client-side.
    const copyToStorage = async (url: string, suffix: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not download ${suffix} stem (HTTP ${res.status})`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const path = `${user.id}/${mashupId}-${suffix}`;
      const { error: upErr } = await admin.storage
        .from("mashups")
        .upload(path, bytes, { contentType: "audio/wav", upsert: true });
      if (upErr) throw new Error(`Could not store ${suffix} stem: ${upErr.message}`);
      return path;
    };

    try {
      const [instrumentalPath, vocalsPath] = await Promise.all([
        copyToStorage(instrumentalUrl, "instrumental.wav"),
        copyToStorage(vocalsUrl, "vocals.wav"),
      ]);

      const payload = { instrumentalPath, vocalsPath };
      await admin
        .from("mashups")
        .update({ status: "done", result_storage_path: JSON.stringify(payload) })
        .eq("id", mashupId);
      return NextResponse.json({ status: "done", ...payload });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save stems";
      await admin
        .from("mashups")
        .update({ status: "failed", result_storage_path: message })
        .eq("id", mashupId);
      return NextResponse.json({ status: "failed", error: message });
    }
  }

  const progressA = a?.task?.progress ?? 0;
  const progressB = b?.task?.progress ?? 0;

  return NextResponse.json({
    status: "processing",
    progress: Math.round((progressA + progressB) / 2),
  });
}
