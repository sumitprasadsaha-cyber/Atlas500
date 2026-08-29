/**
 * End-to-End Atomic Upload Pipeline Integration Test
 * 
 * Verifies:
 * 1. Creation -> Upload -> Verify -> Download -> Delete across brand new School and UPSC chapters/modules.
 * 2. Prefix virtualization: Zero failures when folders/prefixes do not exist in advance.
 * 3. Canonical key consistency across all operations.
 * 4. PutObject execution and atomic HeadObject verification.
 * 5. Download content integrity and exact byte match.
 * 6. Clean deletion and post-delete 404 verification.
 */

import { buildCanonicalStorageKey, generateUUID } from "../src/utils/canonicalStorageKey";
import { uploadObjectToR2, headObjectFromR2, getObjectFromR2, deleteObjectFromR2, getR2ServerConfig } from "../src/lib/r2Server";

async function runE2ETests() {
  console.log("===============================================================");
  console.log("  STARTING ATOMIC UPLOAD PIPELINE E2E INTEGRATION SUITE");
  console.log("===============================================================");

  const config = getR2ServerConfig();
  console.log(`[Config] Target R2 Bucket: "${config.bucket || 'academy-connect-files'}"`);

  const testCases = [
    {
      name: "Brand New School Chapter - Class 10 Physics",
      type: "school" as const,
      className: "Class 10",
      subject: "Physics",
      chapterNumber: 8,
      chapterName: "Electromagnetism and AC Generators",
      topicNumber: 1,
      topicName: "Faradays Law of Induction",
      fileName: "faradays_law_notes.pdf",
      fileContent: "%PDF-1.4\n% Faradays Law Physics Comprehensive Class 10 Notes\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n%%EOF",
      contentType: "application/pdf",
    },
    {
      name: "Brand New School Chapter - Class 12 Mathematics",
      type: "school" as const,
      className: "Class 12",
      subject: "Mathematics",
      chapterNumber: 7,
      chapterName: "Integrals and Differential Equations",
      topicNumber: 3,
      topicName: "Integration by Partial Fractions",
      fileName: "partial_fractions.pdf",
      fileContent: "%PDF-1.4\n% Integrals Class 12 Advanced Study Material\n%%EOF",
      contentType: "application/pdf",
    },
    {
      name: "Brand New UPSC Module - GS2 International Relations",
      type: "upsc" as const,
      gsPaper: "General Studies Paper II",
      subject: "International Relations",
      moduleNumber: 4,
      moduleName: "Bilateral Regional and Global Groupings",
      topicNumber: 2,
      topicName: "Quad and Indo-Pacific Geopolitics",
      fileName: "quad_indo_pacific.pdf",
      fileContent: "%PDF-1.4\n% UPSC GS2 IR In-depth Analysis Quad and Indo-Pacific\n%%EOF",
      contentType: "application/pdf",
    },
    {
      name: "Brand New UPSC Module - GS4 Ethics",
      type: "upsc" as const,
      gsPaper: "GS4",
      subject: "Ethics and Integrity",
      moduleNumber: 2,
      moduleName: "Attitude and Moral Influence",
      topicNumber: 1,
      topicName: "Foundations of Moral Philosophy",
      fileName: "moral_philosophy.png",
      fileContent: "PNG_SAMPLE_BINARY_DATA_FOR_ETHICS_DIAGRAM",
      contentType: "image/png",
    },
  ];

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`\n---------------------------------------------------------------`);
    console.log(`[TEST ${i + 1}/${testCases.length}] ${tc.name}`);
    console.log(`---------------------------------------------------------------`);

    try {
      // 1. Generate Canonical Key
      const customUuid = generateUUID();
      const canonicalKey = buildCanonicalStorageKey({
        type: tc.type,
        className: (tc as any).className,
        gsPaper: (tc as any).gsPaper,
        subject: tc.subject,
        chapterNumber: (tc as any).chapterNumber,
        chapterName: (tc as any).chapterName,
        moduleNumber: (tc as any).moduleNumber,
        moduleName: (tc as any).moduleName,
        topicNumber: tc.topicNumber,
        topicName: tc.topicName,
        fileName: tc.fileName,
        customId: customUuid,
      });

      console.log(`[Step 1] Canonical Key Generated: "${canonicalKey}"`);

      // 2. Upload Object to R2 with atomic HeadObject verification
      const bodyBuffer = Buffer.from(tc.fileContent, "utf-8");
      console.log(`[Step 2] Uploading ${bodyBuffer.length} bytes to R2...`);

      const uploadResult = await uploadObjectToR2({
        bucket: config.bucket,
        key: canonicalKey,
        body: bodyBuffer,
        contentType: tc.contentType,
      });

      console.log(`[Step 2 Confirmed] Upload & Verification Succeeded:`, {
        bucket: uploadResult.bucket,
        key: uploadResult.key,
        etag: uploadResult.etag,
        size: uploadResult.size,
        contentType: uploadResult.contentType,
      });

      if (uploadResult.size !== bodyBuffer.length) {
        throw new Error(`Size mismatch: expected ${bodyBuffer.length}, got ${uploadResult.size}`);
      }

      // 3. Verify HeadObject independently
      console.log(`[Step 3] Independent HeadObject existence check...`);
      const headCheck = await headObjectFromR2({
        bucket: config.bucket,
        key: canonicalKey,
      });

      if (!headCheck.exists) {
        throw new Error(`Independent HeadObject check reported exists=false for key: "${canonicalKey}"`);
      }
      console.log(`[Step 3 Confirmed] Independent HeadObject check PASSED (contentLength: ${headCheck.contentLength}, etag: ${headCheck.etag})`);

      // 4. Download and verify content matches
      console.log(`[Step 4] Downloading object from R2...`);
      const downloadResult = await getObjectFromR2({
        bucket: config.bucket,
        key: canonicalKey,
      });

      if (!downloadResult.body) {
        throw new Error(`Download body was empty for key: "${canonicalKey}"`);
      }

      const downloadedChunks: Buffer[] = [];
      for await (const chunk of downloadResult.body as any) {
        downloadedChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const downloadedBuffer = Buffer.concat(downloadedChunks);
      const downloadedText = downloadedBuffer.toString("utf-8");

      if (downloadedText !== tc.fileContent) {
        throw new Error(`Content integrity failure: Downloaded content does not match uploaded content!`);
      }
      console.log(`[Step 4 Confirmed] Download verified: Exact content match (${downloadedBuffer.length} bytes)`);

      // 5. Clean up - Delete Object from R2
      console.log(`[Step 5] Deleting object from R2...`);
      await deleteObjectFromR2({
        bucket: config.bucket,
        key: canonicalKey,
      });
      console.log(`[Step 5 Confirmed] Deletion command executed.`);

      // 6. Confirm object is gone
      const postDeleteCheck = await headObjectFromR2({
        bucket: config.bucket,
        key: canonicalKey,
      });

      if (postDeleteCheck.exists) {
        throw new Error(`Post-deletion verification failed: Object still exists in R2 after delete!`);
      }
      console.log(`[Step 6 Confirmed] Post-delete HeadObject confirmed object no longer exists.`);

      console.log(`>>> [TEST ${i + 1} RESULT: PASSED] Full lifecycle validated for ${tc.name}`);
      passed++;
    } catch (err: any) {
      console.error(`>>> [TEST ${i + 1} RESULT: FAILED] ${tc.name}:`, err?.message || err);
      failed++;
    }
  }

  console.log(`\n===============================================================`);
  console.log(`  E2E INTEGRATION SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log(`===============================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runE2ETests().catch((err) => {
  console.error("Fatal Test Suite Failure:", err);
  process.exit(1);
});
