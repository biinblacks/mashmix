/**
 * LALAL.AI API client for stem separation (vocal/instrumental splitting).
 * Docs: https://www.lalal.ai/api/help/
 */

const LALAL_BASE_URL = "https://www.lalal.ai/api";

const apiKey = () => {
  const key = process.env.LALAL_API_KEY;
  if (!key) throw new Error("LALAL_API_KEY is not set");
  return key;
};

interface LalalUploadResponse {
  status: "success" | "error";
  id?: string;
  error?: string;
}

interface LalalSplitResponse {
  status: "success" | "error";
  error?: string;
}

/** Per-file task state. This — not the sibling `status` field — reports progress. */
export interface LalalTask {
  state: "success" | "error" | "progress" | "cancelled";
  error?: string | null;
  progress?: number | null;
}

export interface LalalSplitResult {
  duration?: number;
  stem?: string;
  stem_track?: string;
  stem_track_size?: number;
  back_track?: string;
  back_track_size?: number;
}

export interface LalalFileResult {
  /** Whether the *query* for this file succeeded, not whether splitting finished. */
  status: "success" | "error";
  error?: string;
  task?: LalalTask | null;
  split?: LalalSplitResult | null;
}

export interface LalalCheckResponse {
  status: "success" | "error";
  error?: string;
  result?: Record<string, LalalFileResult>;
}

export async function uploadTrack(fileBuffer: Buffer, fileName: string): Promise<string> {
  // Only ASCII is safe in a header value
  const headerSafeName = fileName.replace(/[^\x20-\x7E]/g, "_");

  const response = await fetch(`${LALAL_BASE_URL}/upload/`, {
    method: "POST",
    headers: {
      Authorization: `license ${apiKey()}`,
      "Content-Disposition": `attachment; filename="${headerSafeName}"`,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(fileBuffer),
  });

  const data: LalalUploadResponse = await response.json();
  if (data.status !== "success" || !data.id) {
    throw new Error(data.error || `LALAL upload failed (HTTP ${response.status})`);
  }
  return data.id;
}

export async function startSplit(
  fileId: string,
  stem: "vocals" | "instrumental" = "vocals"
): Promise<void> {
  const form = new FormData();
  form.append("params", JSON.stringify([{ id: fileId, stem, splitter: "phoenix" }]));

  const response = await fetch(`${LALAL_BASE_URL}/split/`, {
    method: "POST",
    headers: { Authorization: `license ${apiKey()}` },
    body: form,
  });

  const data: LalalSplitResponse = await response.json();
  if (data.status !== "success") {
    throw new Error(data.error || `LALAL split request failed (HTTP ${response.status})`);
  }
}

/**
 * Check one or more split tasks.
 * The API expects a POST with a form field holding comma-separated ids.
 * Returns the raw response so callers can persist it for diagnostics.
 */
export async function checkSplitStatuses(fileIds: string[]): Promise<LalalCheckResponse> {
  const form = new FormData();
  form.append("id", fileIds.join(","));

  const response = await fetch(`${LALAL_BASE_URL}/check/`, {
    method: "POST",
    headers: { Authorization: `license ${apiKey()}` },
    body: form,
  });

  const text = await response.text();
  try {
    return JSON.parse(text) as LalalCheckResponse;
  } catch {
    return {
      status: "error",
      error: `Unexpected response from LALAL (HTTP ${response.status}): ${text.slice(0, 200)}`,
    };
  }
}
