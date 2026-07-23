import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { findAllMatches } from "@/lib/matching/camelot";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: tracks, error } = await admin
    .from("tracks")
    .select("id, file_name, bpm, musical_key, analysis_status")
    .eq("user_id", user.id)
    .eq("analysis_status", "done");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const analyzedTracks = (tracks ?? []).filter((t) => t.bpm && t.musical_key);

  if (analyzedTracks.length < 2) {
    return NextResponse.json({
      matches: [],
      message: "Need at least 2 analyzed tracks to find matches",
    });
  }

  const matches = findAllMatches(
    analyzedTracks.map((t) => ({
      id: t.id,
      file_name: t.file_name,
      bpm: t.bpm!,
      musical_key: t.musical_key!,
    }))
  );

  // Clear old suggestions for this user, then insert fresh ones
  await admin.from("match_suggestions").delete().eq("user_id", user.id);

  if (matches.length > 0) {
    await admin.from("match_suggestions").insert(
      matches.map((m) => ({
        user_id: user.id,
        track_a_id: m.trackAId,
        track_b_id: m.trackBId,
        compatibility_score: m.compatibilityScore,
        bpm_diff: m.bpmDiff,
        key_relation: m.keyRelation,
      }))
    );
  }

  // Return with track names attached for the UI
  const trackMap = new Map(analyzedTracks.map((t) => [t.id, t]));
  const enrichedMatches = matches.map((m) => ({
    ...m,
    trackAName: trackMap.get(m.trackAId)?.file_name,
    trackBName: trackMap.get(m.trackBId)?.file_name,
  }));

  return NextResponse.json({ matches: enrichedMatches });
}
