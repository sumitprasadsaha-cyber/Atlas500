import { uploadObjectToR2, deleteObjectsFromR2, listObjectsFromR2 } from "../src/lib/r2Server";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://kffaehofciebfqczhfxm.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_t9Xgetmt4736XUtCrAq8pQ_zcTJWzUg";

async function supabaseFetch(endpoint: string, options: RequestInit = {}) {
  const base = SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
  const url = `${base}/rest/v1/${endpoint}`;
  const headers: Record<string, string> = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
    ...(options.headers as Record<string, string> || {}),
  };

  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const txt = await res.text();
      return { data: null, error: new Error(`HTTP ${res.status}: ${txt}`) };
    }
    const data = await res.json().catch(() => []);
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err };
  }
}

async function runCleanup() {
  console.log("=================================================");
  console.log("STARTING ONE-TIME DATABASE CLEANUP VIA REST API");
  console.log("Supabase URL:", SUPABASE_URL);
  console.log("=================================================");

  // 1. Clean Storage buckets in R2
  console.log("\n[Step 1] Cleaning practice test storage files in academy-connect-files...");
  try {
    const emptyJsonBlob = Buffer.from(JSON.stringify({}, null, 2), "utf-8");
    const emptyArrBlob = Buffer.from(JSON.stringify([], null, 2), "utf-8");
    await uploadObjectToR2({ bucket: "academy-connect-files", key: "practice_tests/test_bank.json", body: emptyJsonBlob, contentType: "application/json" });
    await uploadObjectToR2({ bucket: "academy-connect-files", key: "practice_tests/test_attempts.json", body: emptyArrBlob, contentType: "application/json" });

    const { objects: fileList } = await listObjectsFromR2({ bucket: "academy-connect-files", prefix: "practice_tests/student_attempts" });
    if (fileList && fileList.length > 0) {
      const paths = fileList.map((f: any) => f.key);
      await deleteObjectsFromR2({ bucket: "academy-connect-files", keys: paths });
      console.log(`Deleted ${paths.length} student attempt files from R2 Storage.`);
    }
  } catch (stErr: any) {
    console.warn("Storage cleanup notice:", stErr.message);
  }

  // 2. Check and delete child records in Supabase (if reachable)
  console.log("\n[Step 2] Cleaning legacy Supabase records via REST API...");
  await supabaseFetch("student_practice_test_attempts?id=neq.00000000-0000-0000-0000-000000000000", { method: "DELETE" });
  await supabaseFetch("topic_assessment_questions?id=neq.00000000-0000-0000-0000-000000000000", { method: "DELETE" });

  console.log("\n✓ Cleanup script executed successfully.");
}

runCleanup().catch((err) => {
  console.error("Cleanup notice:", err);
});

