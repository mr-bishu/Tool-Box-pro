import { getStore } from "@netlify/blobs";

/** Processed files are kept for one hour, then removed by the cleanup-results scheduled function. */
export const RESULT_TTL_MS = 60 * 60 * 1000;
export const RESULT_KEY_PATTERN = /^\d{13}-[0-9a-f-]{36}\/[a-zA-Z0-9._-]+$/;

export const resultStore = () => getStore("tool-results");

export const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "file";

/** Stores a processed file and returns its public download URL. */
export async function saveResult(fileName: string, data: Uint8Array | ArrayBuffer): Promise<string> {
  const key = `${Date.now()}-${crypto.randomUUID()}/${safeFileName(fileName)}`;
  await resultStore().set(key, data instanceof Uint8Array ? new Blob([data]) : data);
  return `/api/tools/download?file=${encodeURIComponent(key)}`;
}

export const resultCreatedAt = (key: string) => Number(key.slice(0, 13));
