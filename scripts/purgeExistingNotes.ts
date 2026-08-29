import dotenv from "dotenv";
dotenv.config();

import { listObjectsFromR2, deleteObjectsFromR2, getR2ServerConfig } from "../src/lib/r2Server";

async function purgeAllNotes() {
  console.log("==================================================");
  console.log("PURGING ALL EXISTING UPLOADED NOTES FROM STORAGE");
  console.log("==================================================");

  const { bucket } = getR2ServerConfig();
  console.log(`Target Bucket: ${bucket}`);

  const prefixes = [
    "class_notes/",
    "upsc_notes/",
    "School/",
    "UPSC/",
    "notes/",
    "test_notes/",
    "uploads/",
    "practice_tests/student_attempts",
  ];

  let totalDeleted = 0;

  for (const prefix of prefixes) {
    try {
      console.log(`Listing objects with prefix: "${prefix}"...`);
      const { objects } = await listObjectsFromR2({ bucket, prefix });
      if (objects && objects.length > 0) {
        const keys = objects.map((o: any) => o.key).filter(Boolean);
        console.log(`Found ${keys.length} objects under "${prefix}". Deleting...`);
        // Batch in chunks of 500
        for (let i = 0; i < keys.length; i += 500) {
          const chunk = keys.slice(i, i + 500);
          await deleteObjectsFromR2({ bucket, keys: chunk });
          totalDeleted += chunk.length;
        }
        console.log(`Successfully deleted ${keys.length} objects for prefix "${prefix}".`);
      } else {
        console.log(`No objects found under prefix "${prefix}".`);
      }
    } catch (err: any) {
      console.warn(`Warning deleting prefix "${prefix}":`, err?.message || err);
    }
  }

  console.log(`\n✓ Storage purge completed. Total files deleted from R2: ${totalDeleted}`);
}

purgeAllNotes().catch((e) => {
  console.error("Purge script error:", e);
});
