/**
 * Release 6.0.0 — Storage Integrity Verification CLI Tool
 *
 * Scans all Firestore notes and verifies that every canonical storageKey exists
 * in Cloudflare R2 via non-destructive HeadObject checks, audits metadata consistency,
 * and reports orphaned objects in R2 storage.
 *
 * Usage:
 *   npx tsx scripts/verifyStorageIntegrity.ts
 */

import { auditStorageIntegrity } from "../src/lib/storageIntegrityService";

async function main() {
  console.log("\n========================================================");
  console.log("  RELEASE 6.0.0 — TOPIC NOTE STORAGE INTEGRITY AUDIT");
  console.log("========================================================\n");

  const report = await auditStorageIntegrity((checked, total, title) => {
    process.stdout.write(`\r[${checked}/${total}] Auditing: ${title.slice(0, 40).padEnd(40)}`);
  });

  console.log("\n\n--------------------------------------------------------");
  console.log("  AUDIT SUMMARY (v6.0.0)");
  console.log("--------------------------------------------------------");
  console.log(`  Target Bucket:       ${report.bucket}`);
  console.log(`  Total Notes:         ${report.totalNotes}`);
  console.log(`  Healthy in R2:       ${report.healthyCount}`);
  console.log(`  Missing in R2:       ${report.missingCount}`);
  console.log(`  Empty (0-byte):      ${report.emptyCount}`);
  console.log(`  Inconsistent Meta:   ${report.inconsistentCount}`);
  console.log(`  Orphaned R2 Objects: ${report.orphanedCount}`);
  console.log(`  Error Count:         ${report.errorCount}`);
  console.log(`  Integrity Rate:      ${report.healthPercentage}%`);
  console.log("--------------------------------------------------------\n");

  if (report.missingCount === 0 && report.errorCount === 0 && report.emptyCount === 0) {
    console.log("✨ ALL TOPIC NOTES ARE 100% HEALTHY AND VERIFIED IN R2 STORAGE.\n");
    process.exit(0);
  } else {
    console.log("⚠️ Some note storage issues were detected during the audit.\n");
    process.exit(report.missingCount > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error("Audit aborted with unhandled error:", err);
  process.exit(1);
});
