import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { uploadTrack, startSplit } from "@/lib/lalal/client";

// Uploading two ~15MB files to LALAL takes a while; ask Vercel for headroom.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.LALAL_API_KEY) {
    return NextResponse.json(
      { error: "LALAL_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  const { trackAId, trackBId } = await request.json();
  if (!trackAId || !trackBId) {
    return NextResponse.json({ error: "trackAId and trackBId required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("subscription_status")
    .eq("id", user.id)
    .single();

  if (profile?.subscription_status !== "active") {
    return NextResponse.json(
      { error: "Mashup generation requires MashMix Pro", code: "UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  const { data: tracks, error: tracksError } = await admin
    .from("tracks")
    .select("*")
    .in("id", [trackAId, trackBId])
    .eq("user_id", user.id);

  if (tracksError || !tracks || tracks.length !== 2) {
    return NextResponse.json({ error: "Tracks not found" }, { status: 404 });
  }

  const trackA = tracks.find((t) => t.id === trackAId)!;
  const trackB = tracks.find((t) => t.id === trackBId)!;

  const { data: mashupRow, error: mashupError } = await admin
    .from("mashups")
    .insert({ user_id: user.id, track_a_id: trackAId, track_b_id: trackBId, status: "processing" })
    .select()
    .single();

  if (mashupError || !mashupRow) {
    return NextResponse.json({ error: "Could not create mashup job" }, { status: 500 });
  }

  try {
    const [fileAData, fileBData] = await Promise.all([
      admin.storage.from("tracks").download(trackA.storage_path),
      admin.storage.from("tracks").download(trackB.storage_path),
    ]);

    if (!fileAData.data || !fileBData.data) {
      throw new Error("Could not read track files from storage");
    }

    const bufferA = Buffer.from(await fileAData.data.arrayBuffer());
    const bufferB = Buffer.from(await fileBData.data.arrayBuffer());

    const [fileIdA, fileIdB] = await Promise.all([
      uploadTrack(bufferA, trackA.file_name),
      uploadTrack(bufferB, trackB.file_name),
    ]);

    // Track A supplies the instrumental, track B supplies the vocals
    await Promise.all([startSplit(fileIdA, "vocals"), startSplit(fileIdB, "vocals")]);

    await admin
      .from("mashups")
      .update({ lalal_task_id: `${fileIdA}:${fileIdB}` })
      .eq("id", mashupRow.id);

    return NextResponse.json({ success: true, mashupId: mashupRow.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mashup start failed";
    await admin
      .from("mashups")
      .update({ status: "failed", result_storage_path: message })
      .eq("id", mashupRow.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
