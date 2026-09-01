import "dotenv/config";
import { uploadObjectToR2, getObjectFromR2, deleteObjectFromR2 } from "../src/lib/r2Server";
import { Readable } from "stream";

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function runStressTest() {
  console.log("=== STRESS TEST: 20 Sequential & Rapid Note Fetches from Cloudflare R2 ===");
  const testKey = `class_notes/Class_10/Science/Chapter_01/Topic_01/stress_test_${Date.now()}.pdf`;
  const pdfContent = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\nxref\n0 2\ntrailer<</Size 2/Root 1 0 R>>\nstartxref\n50\n%%EOF");

  console.log(`1. Uploading test note to R2: ${testKey}`);
  const uploadRes = await uploadObjectToR2({
    key: testKey,
    body: pdfContent,
    contentType: "application/pdf",
  });
  console.log("   Upload complete, ETag:", uploadRes.etag);

  console.log("\n2. Executing 20 consecutive GetObject requests...");
  let successCount = 0;
  let forbiddenCount = 0;
  let otherErrorCount = 0;

  for (let i = 1; i <= 20; i++) {
    const t0 = Date.now();
    try {
      const obj = await getObjectFromR2({ key: testKey });
      if (obj && obj.body) {
        const buf = await streamToBuffer(obj.body);
        if (buf.length === pdfContent.length) {
          successCount++;
          console.log(`   [Request ${i}/20] ✅ SUCCESS (Bytes: ${buf.length}, Time: ${Date.now() - t0}ms)`);
        } else {
          console.error(`   [Request ${i}/20] ❌ Truncated data: got ${buf.length} bytes, expected ${pdfContent.length}`);
        }
      } else {
        console.error(`   [Request ${i}/20] ❌ No body returned`);
      }
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 403 || err?.code === "AccessDenied") {
        forbiddenCount++;
        console.error(`   [Request ${i}/20] ❌ 403 FORBIDDEN:`, err?.message);
      } else {
        otherErrorCount++;
        console.error(`   [Request ${i}/20] ❌ Error:`, err?.message || err);
      }
    }
  }

  console.log("\n3. Cleaning up test note from R2...");
  await deleteObjectFromR2({ key: testKey });
  console.log("   Cleanup finished.");

  console.log("\n==================================================");
  console.log(`STRESS TEST SUMMARY:`);
  console.log(`  Total Requests: 20`);
  console.log(`  Successes:      ${successCount}`);
  console.log(`  403 Errors:     ${forbiddenCount}`);
  console.log(`  Other Errors:   ${otherErrorCount}`);
  console.log("==================================================");

  if (forbiddenCount > 0 || otherErrorCount > 0 || successCount !== 20) {
    console.error("❌ STRESS TEST FAILED! Intermittent failures detected.");
    process.exit(1);
  } else {
    console.log("✨ 100% SUCCESS RATE ACROSS 20 RAPID SEQUENTIAL REQUESTS WITH 0 403 ERRORS!");
    process.exit(0);
  }
}

runStressTest();
