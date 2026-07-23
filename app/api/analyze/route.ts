import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { trackId } = await request.json();
  if (!trackId) {
    return NextResponse.json({ error: "trackId required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch track and confirm ownership
  const { data: track, error: trackError } = await admin
    .from("tracks")
    .select("*")
    .eq("id", trackId)
    .eq("user_id", user.id)
    .single();

  if (trackError || !track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  // Download the file from Supabase Storage
  const { data: fileData, error: downloadError } = await admin.storage
    .from("tracks")
    .download(track.storage_path);

  if (downloadError || !fileData) {
    return NextResponse.json({ error: "Could not read uploaded file" }, { status: 500 });
  }

  await admin.from("tracks").update({ analysis_status: "processing" }).eq("id", trackId);

  // Forward to the Python analyzer microservice
  try {
    const formData = new FormData();
    formData.append("file", fileData, track.file_name);
    formData.append("track_id", trackId);

    const analyzerUrl = process.env.ANALYSIS_SERVICE_URL;
    if (!analyzerUrl) {
      throw new Error("ANALYSIS_SERVICE_URL not configured");
    }

    const analyzeResponse = await fetch(`${analyzerUrl}/analyze`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ANALYZER_SECRET}`,
      },
      body: formData,
    });

    if (!analyzeResponse.ok) {
      const errText = await analyzeResponse.text();
      throw new Error(`Analyzer service error: ${errText}`);
    }

    const result = await analyzeResponse.json();
    return NextResponse.json({ success: true, result });
  } catch (err) {
    await admin.from("tracks").update({ analysis_status: "failed" }).eq("id", trackId);
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
