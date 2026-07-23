/**
 * LALAL.ai API client for stem separation (vocal/instrumental splitting).
 * Docs: https://www.lalal.ai/api/help/
 */

const LALAL_BASE_URL = "https://www.lalal.ai/api";

interface LalalUploadResponse {
  status: "success" | "error";
  id?: string;
  error?: string;
}

interface LalalSplitResponse {
  status: "success" | "error";
  error?: string;
}

interface LalalFileResult {
  status: "success" | "progress" | "error";
  split?: {
    stem_track?: string; // URL to vocal/stem
    back_track?: string; // URL to instrumental
  };
  error?: string;
}

interface LalalCheckResult {
  status: "success" | "error";
  result?: Record<string, LalalFileResult>;
}

const apiKey = () => {
  const key = process.env.LALAL_API_KEY;
  if (!key) throw new Error("LALAL_API_KEY is not set");
  return key;
};

export async function uploadTrack(fileBuffer: Buffer, fileName: string): Promise<string> {
  const response = await fetch(`${LALAL_BASE_URL}/upload/`, {
    method: "POST",
    headers: {
      Authorization: `license ${apiKey()}`,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
    body: fileBuffer as unknown as BodyInit,
  });

  const data: LalalUploadResponse = await response.json();
  if (data.status !== "success" || !data.id) {
    throw new Error(data.error || "LALAL upload failed");
  }
  return data.id;
}

export async function startSplit(fileId: string, stem: "vocals" | "instrumental" = "vocals"): Promise<void> {
  const params = new URLSearchParams();
  params.set(
    "params",
    JSON.stringify([{ id: fileId, stem, splitter: "phoenix" }])
  );

  const response = await fetch(`${LALAL_BASE_URL}/split/`, {
    method: "POST",
    headers: {
      Authorization: `license ${apiKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const data: LalalSplitResponse = await response.json();
  if (data.status !== "success") {
    throw new Error(data.error || "LALAL split request failed");
  }
}

export async function checkSplitStatus(fileId: string): Promise<LalalFileResult | null> {
  const params = new URLSearchParams();
  params.set("id", fileId);

  const response = await fetch(`${LALAL_BASE_URL}/check/?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `license ${apiKey()}` },
  });

  const data: LalalCheckResult = await response.json();
  if (data.status !== "success" || !data.result) return null;
  return data.result[fileId] ?? null;
}

/** Poll until split is done or failed, with a max timeout */
export async function waitForSplit(
  fileId: string,
  { timeoutMs = 5 * 60 * 1000, intervalMs = 4000 } = {}
): Promise<{ stemUrl: string; backTrackUrl: string }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await checkSplitStatus(fileId);

    if (result?.status === "success" && result.split) {
      return {
        stemUrl: result.split.stem_track ?? "",
        backTrackUrl: result.split.back_track ?? "",
      };
    }
    if (result?.status === "error") {
      throw new Error(result.error || "LALAL split failed");
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error("LALAL split timed out");
}
