import type { Config } from "@netlify/functions";
import { resultStore, RESULT_TTL_MS, resultCreatedAt } from "../../lib/results.js";

// Deletes processed files older than one hour
export default async () => {
  const store = resultStore();
  const cutoff = Date.now() - RESULT_TTL_MS;
  let deleted = 0;

  for await (const page of store.list({ paginate: true })) {
    const expired = page.blobs.filter((blob) => resultCreatedAt(blob.key) < cutoff);
    await Promise.all(expired.map((blob) => store.delete(blob.key)));
    deleted += expired.length;
  }

  console.log(`Removed ${deleted} expired result files`);
};

export const config: Config = {
  schedule: "*/30 * * * *",
};
