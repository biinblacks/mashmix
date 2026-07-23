import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { uploadTrack, startSplit, waitForSplit } from "@/lib/lalal/client";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
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

  const { data: mashupRow } = await admin
    .from("mashups")
    .insert({ user_id: user.id, track_a_id: trackAId, track_b_id: trackBId, status: "processing" })
    .select()
    .single();

  try {
    // Download both tracks from storage
    const [fileAData, fileBData] = await Promise.all([
      admin.storage.from("tracks").download(trackA.storage_path),
      admin.storage.from("tracks").download(trackB.storage_path),
    ]);

    if (!fileAData.data || !fileBData.data) {
      throw new Error("Could not read track files from storage");
    }

    const bufferA = Buffer.from(await fileAData.data.arrayBuffer());
    const bufferB = Buffer.from(await fileBData.data.arrayBuffer());

    // Track A: extract instrumental (backing track)
    // Track B: extract vocals (to lay over track A's instrumental)
    const [fileIdA, fileIdB] = await Promise.all([
      uploadTrack(bufferA, trackA.file_name),
      uploadTrack(bufferB, trackB.file_name),
    ]);

    await Promise.all([
      startSplit(fileIdA, "vocals"), // we'll use back_track (instrumental) from this
      startSplit(fileIdB, "vocals"), // we'll use stem_track (vocals) from this
    ]);

    const [resultA, resultB] = await Promise.all([
      waitForSplit(fileIdA),
      waitForSplit(fileIdB),
    ]);

    // Store the two resulting stem URLs — actual audio mixing (combining
    // instrumental + vocals into one file) happens client-side or in a
    // follow-up render step, since that's simple ffmpeg work, not AI.
    await admin
      .from("mashups")
      .update({
        status: "done",
        lalal_task_id: `${fileIdA}:${fileIdB}`,
        result_storage_path: JSON.stringify({
          instrumental: resultA.backTrackUrl,
          vocals: resultB.stemUrl,
        }),
      })
      .eq("id", mashupRow.id);

    return NextResponse.json({
      success: true,
      mashupId: mashupRow.id,
      instrumentalUrl: resultA.backTrackUrl,
      vocalsUrl: resultB.stemUrl,
    });
  } catch (err) {
    await admin.from("mashups").update({ status: "failed" }).eq("id", mashupRow.id);
    const message = err instanceof Error ? err.message : "Mashup generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
