"use client";

import { useState, useCallback, useRef } from "react";
import { Upload, Music, Loader2, Sparkles, Crown } from "lucide-react";
import CamelotWheel from "@/components/CamelotWheel";
import { createClient } from "@/lib/supabase/client";

interface Track {
  id: string;
  file_name: string;
  bpm: number | null;
  musical_key: string | null;
  analysis_status: string;
}

interface MatchResult {
  trackAId: string;
  trackBId: string;
  compatibilityScore: number;
  bpmDiff: number;
  keyRelation: string;
  trackAName: string;
  trackBName: string;
}

interface DashboardClientProps {
  userEmail: string;
  isPro: boolean;
  usageCount: number;
  initialTracks: Track[];
}

const KEY_RELATION_LABELS: Record<string, string> = {
  same: "Same key",
  relative_major_minor: "Relative major/minor",
  energy_boost: "Energy boost",
  energy_drop: "Energy drop",
  adjacent: "Adjacent key",
};

export default function DashboardClient({
  userEmail,
  isPro,
  usageCount,
  initialTracks,
}: DashboardClientProps) {
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [generatingMashup, setGeneratingMashup] = useState<string | null>(null);
  const [mashupResult, setMashupResult] = useState<{ instrumentalUrl: string; vocalsUrl: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const handleUpload = useCallback(async (files: FileList) => {
    setUploading(true);
    setErrorMsg(null);

    const ALLOWED_TYPES = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp3", "audio/mp4", "audio/x-m4a"];
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file (Supabase Storage limit, not Vercel's)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setErrorMsg("Please log in again.");
        setUploading(false);
        return;
      }

      // Check usage limit client-side (reads own profile row, allowed by RLS)
      const { data: profile } = await supabase
        .from("profiles")
        .select("subscription_status, usage_count_this_month")
        .eq("id", user.id)
        .single();

      const isPro = profile?.subscription_status === "active";
      const freeLimit = 3;
      const validFiles = Array.from(files).filter(
        (f) => ALLOWED_TYPES.includes(f.type) && f.size <= MAX_FILE_SIZE
      );

      if (!isPro && (profile?.usage_count_this_month ?? 0) + validFiles.length > freeLimit) {
        setErrorMsg(`Free plan allows ${freeLimit} uploads/month. Upgrade to MashMix Pro for unlimited.`);
        setUploading(false);
        return;
      }

      // Upload directly browser -> Supabase Storage (bypasses Vercel's 4.5MB function payload limit entirely)
      const newTracks: Track[] = [];
      for (const file of validFiles) {
        const storagePath = `${user.id}/${Date.now()}-${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from("tracks")
          .upload(storagePath, file, { contentType: file.type });

        if (uploadError) continue;

        const { data: trackRow, error: insertError } = await supabase
          .from("tracks")
          .insert({
            user_id: user.id,
            file_name: file.name,
            storage_path: storagePath,
            analysis_status: "pending",
          })
          .select()
          .single();

        if (!insertError && trackRow) newTracks.push(trackRow);
      }

      if (!isPro && newTracks.length > 0) {
        await supabase
          .from("profiles")
          .update({ usage_count_this_month: (profile?.usage_count_this_month ?? 0) + newTracks.length })
          .eq("id", user.id);
      }

      setTracks((prev) => [...newTracks, ...prev]);
      setUploading(false);

      // Kick off analysis for each uploaded track (server-side, file bytes fetched
      // from Storage there, not from the client request, so no size limit issue)
      setAnalyzing(true);
      await Promise.all(
        newTracks.map((t) =>
          fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trackId: t.id }),
          }).catch(() => null)
        )
      );

      const { data: refreshedTracks } = await supabase
        .from("tracks")
        .select("*")
        .order("created_at", { ascending: false });

      if (refreshedTracks) setTracks(refreshedTracks);
      setAnalyzing(false);
    } catch {
      setErrorMsg("Upload failed. Check your connection and try again.");
      setUploading(false);
      setAnalyzing(false);
    }
  }, [supabase]);

  const handleFindMatches = useCallback(async () => {
    setMatching(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/match", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "Matching failed");
      } else {
        setMatches(data.matches ?? []);
      }
    } catch {
      setErrorMsg("Could not compute matches. Try again.");
    }
    setMatching(false);
  }, []);

  const handleGenerateMashup = useCallback(async (trackAId: string, trackBId: string) => {
    setGeneratingMashup(`${trackAId}-${trackBId}`);
    setErrorMsg(null);
    setMashupResult(null);

    try {
      const res = await fetch("/api/mashup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackAId, trackBId }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.code === "UPGRADE_REQUIRED") {
          setErrorMsg("Generating mashups requires MashMix Pro. Upgrade to continue.");
        } else {
          setErrorMsg(data.error ?? "Mashup generation failed");
        }
      } else {
        setMashupResult({ instrumentalUrl: data.instrumentalUrl, vocalsUrl: data.vocalsUrl });
      }
    } catch {
      setErrorMsg("Mashup generation failed. Try again.");
    }
    setGeneratingMashup(null);
  }, []);

  const handleUpgrade = useCallback(async () => {
    const res = await fetch("/api/stripe/checkout", { method: "POST" });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  }, []);

  const analyzedTracks = tracks.filter((t) => t.analysis_status === "done" && t.bpm && t.musical_key);
  const wheelTracks = analyzedTracks.map((t) => ({
    id: t.id,
    fileName: t.file_name,
    camelotKey: t.musical_key!,
  }));
  const wheelConnections = matches.map((m) => ({
    trackAId: m.trackAId,
    trackBId: m.trackBId,
    score: m.compatibilityScore,
  }));

  return (
    <div className="min-h-screen bg-[var(--color-ink)] pb-24">
      <header className="flex items-center justify-between border-b border-[var(--color-line)] px-6 py-5 sm:px-10">
        <span className="font-display text-lg font-bold text-[var(--color-paper)]">MASHMIX</span>
        <div className="flex items-center gap-4">
          {isPro ? (
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-amber)]/15 px-3 py-1 text-xs font-medium text-[var(--color-amber)]">
              <Crown size={12} /> Pro
            </span>
          ) : (
            <button
              onClick={handleUpgrade}
              className="rounded-full bg-gradient-to-r from-[var(--color-magenta)] to-[var(--color-violet)] px-4 py-1.5 text-xs font-semibold text-[var(--color-paper)]"
            >
              Upgrade to Pro
            </button>
          )}
          <span className="text-sm text-[var(--color-paper)]/50">{userEmail}</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        {!isPro && (
          <p className="mb-6 text-sm text-[var(--color-paper)]/50">
            {usageCount}/3 free uploads used this month.
          </p>
        )}

        {errorMsg && (
          <div className="mb-6 rounded-lg border border-[var(--color-magenta)]/40 bg-[var(--color-magenta)]/10 px-4 py-3 text-sm text-[var(--color-paper)]">
            {errorMsg}
          </div>
        )}

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
          }}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--color-line)] px-6 py-14 text-center hover:border-[var(--color-violet)]/50 transition-colors"
        >
          <Upload size={28} className="text-[var(--color-paper)]/40" />
          <p className="mt-4 font-display text-lg font-semibold text-[var(--color-paper)]">
            Drop your music folder here
          </p>
          <p className="mt-1 text-sm text-[var(--color-paper)]/50">or click to browse — MP3, WAV</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || analyzing}
            className="mt-5 rounded-full bg-white/[0.06] px-5 py-2 text-sm font-medium text-[var(--color-paper)] disabled:opacity-50"
          >
            {uploading ? "Uploading…" : analyzing ? "Analyzing tracks…" : "Choose files"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="audio/*"
            className="hidden"
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />
        </div>

        {tracks.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-lg font-semibold text-[var(--color-paper)]">Your tracks</h2>
            <div className="mt-4 divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
              {tracks.map((track) => (
                <div key={track.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Music size={16} className="text-[var(--color-paper)]/40" />
                    <span className="text-sm text-[var(--color-paper)]">{track.file_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--color-paper)]/50">
                    {track.analysis_status === "done" && track.bpm && (
                      <>
                        <span>{Math.round(track.bpm)} BPM</span>
                        <span className="rounded bg-white/[0.06] px-2 py-0.5 font-display">
                          {track.musical_key}
                        </span>
                      </>
                    )}
                    {track.analysis_status === "processing" && (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                    {track.analysis_status === "failed" && (
                      <span className="text-[var(--color-magenta)]">Analysis failed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {analyzedTracks.length >= 2 && (
              <button
                onClick={handleFindMatches}
                disabled={matching}
                className="mt-5 flex items-center gap-2 rounded-full bg-gradient-to-r from-[var(--color-magenta)] to-[var(--color-violet)] px-5 py-2.5 font-display text-sm font-semibold text-[var(--color-paper)] disabled:opacity-50"
              >
                <Sparkles size={16} />
                {matching ? "Finding matches…" : "Find mashup matches"}
              </button>
            )}
          </section>
        )}

        {analyzedTracks.length >= 2 && (
          <section className="mt-12 grid gap-10 lg:grid-cols-[380px_1fr]">
            <div className="flex justify-center">
              <CamelotWheel tracks={wheelTracks} connections={wheelConnections} size={340} />
            </div>

            {matches.length > 0 && (
              <div>
                <h2 className="font-display text-lg font-semibold text-[var(--color-paper)]">
                  Ranked matches
                </h2>
                <div className="mt-4 space-y-3">
                  {matches.map((m) => {
                    const key = `${m.trackAId}-${m.trackBId}`;
                    return (
                      <div
                        key={key}
                        className="rounded-xl border border-[var(--color-line)] bg-white/[0.02] px-5 py-4"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-[var(--color-paper)]">
                              {m.trackAName} + {m.trackBName}
                            </p>
                            <p className="mt-1 text-xs text-[var(--color-paper)]/50">
                              {KEY_RELATION_LABELS[m.keyRelation] ?? m.keyRelation} · Δ{m.bpmDiff} BPM
                            </p>
                          </div>
                          <span className="font-display text-lg font-bold text-[var(--color-amber)]">
                            {m.compatibilityScore}%
                          </span>
                        </div>
                        <button
                          onClick={() => handleGenerateMashup(m.trackAId, m.trackBId)}
                          disabled={generatingMashup === key}
                          className="mt-3 w-full rounded-full bg-white/[0.06] py-2 text-xs font-medium text-[var(--color-paper)] disabled:opacity-50"
                        >
                          {generatingMashup === key ? "Generating mashup…" : "Generate mashup"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {mashupResult && (
          <section className="mt-10 rounded-xl border border-[var(--color-line)] bg-white/[0.02] p-6">
            <h3 className="font-display text-lg font-semibold text-[var(--color-paper)]">Mashup ready</h3>
            <div className="mt-4 space-y-3">
              <div>
                <p className="text-xs text-[var(--color-paper)]/50 mb-1">Instrumental</p>
                <audio controls src={mashupResult.instrumentalUrl} className="w-full" />
              </div>
              <div>
                <p className="text-xs text-[var(--color-paper)]/50 mb-1">Vocals</p>
                <audio controls src={mashupResult.vocalsUrl} className="w-full" />
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
