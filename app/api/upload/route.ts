import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const ALLOWED_TYPES = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp3", "audio/mp4", "audio/x-m4a"];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Check subscription / usage limits before accepting uploads
  const { data: profile } = await admin
    .from("profiles")
    .select("subscription_status, usage_count_this_month")
    .eq("id", user.id)
    .single();

  const isPro = profile?.subscription_status === "active";
  const freeLimit = 3;

  const formData = await request.formData();
  const files = formData.getAll("files") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  if (!isPro && (profile?.usage_count_this_month ?? 0) + files.length > freeLimit) {
    return NextResponse.json(
      {
        error: `Free plan allows ${freeLimit} uploads/month. Upgrade to MashMix Pro for unlimited.`,
        code: "USAGE_LIMIT_REACHED",
      },
      { status: 403 }
    );
  }

  const uploadedTracks = [];

  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      continue; // skip non-audio files silently (e.g. .DS_Store from folder uploads)
    }
    if (file.size > MAX_FILE_SIZE) {
      continue;
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const storagePath = `${user.id}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await admin.storage
      .from("tracks")
      .upload(storagePath, buffer, { contentType: file.type });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      continue;
    }

    const { data: trackRow, error: insertError } = await admin
      .from("tracks")
      .insert({
        user_id: user.id,
        file_name: file.name,
        storage_path: storagePath,
        analysis_status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      continue;
    }

    uploadedTracks.push(trackRow);
  }

  if (!isPro && uploadedTracks.length > 0) {
    await admin
      .from("profiles")
      .update({
        usage_count_this_month: (profile?.usage_count_this_month ?? 0) + uploadedTracks.length,
      })
      .eq("id", user.id);
  }

  return NextResponse.json({ success: true, tracks: uploadedTracks });
}
