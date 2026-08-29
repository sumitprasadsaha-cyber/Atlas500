import { strict as assert } from "node:assert";
import { getBucketName } from "../src/lib/storageService";
import {
  uploadObjectToR2,
  getObjectFromR2,
  generateR2SignedUrl,
  deleteObjectFromR2,
  headObjectFromR2,
} from "../src/lib/r2Server";
import { sanitizeKey, getMimeType } from "../api/_lib/utils";

async function main() {
  const studentId = "student-1784378546110";
  const bucket = getBucketName();

  console.log("=== Starting Topic Notes Retrieval & Storage Validation Suite (v6.0.0) ===");

  // --- Test 1: PDF Upload & Retrieval ---
  console.log("\n[Test 1] PDF Upload & Stream Retrieval...");
  const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF", "utf8");
  const pdfFileName = "1784760657941-Chapter1.pdf";
  const pdfKey = `notes/${studentId}/${Date.now()}-${pdfFileName}`;

  const pdfUploadRes = await uploadObjectToR2({
    bucket,
    key: pdfKey,
    body: pdfBytes,
    contentType: "application/pdf",
  });
  assert.equal(pdfUploadRes.bucket, bucket);
  assert.equal(pdfUploadRes.key, pdfKey);

  const pdfHead = await headObjectFromR2({ bucket, key: pdfKey });
  assert.equal(pdfHead.exists, true, "PDF must exist after upload");

  const pdfSignedUrl = await generateR2SignedUrl({
    bucket,
    key: pdfKey,
    expiresIn: 3600,
    contentType: "application/pdf",
  });
  assert.ok(pdfSignedUrl.length > 0, "PDF signedUrl must not be empty");

  const pdfGet = await getObjectFromR2({ bucket, key: pdfKey });
  assert.ok(pdfGet.body, "PDF GetObject body stream must be present");
  let pdfChunks = 0;
  for await (const chunk of pdfGet.body) {
    pdfChunks += chunk.length;
  }
  assert.equal(pdfChunks, pdfBytes.length, "PDF streamed bytes must match upload size");
  console.log("✓ Test 1 Passed: PDF stream verified successfully.");

  // --- Test 2: Image (PNG / JPEG) Upload & Stream ---
  console.log("\n[Test 2] Image (PNG/JPEG) Upload & Stream Retrieval...");
  const imgBytes = Buffer.from("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4", "binary");
  const imgKey = `notes/${studentId}/${Date.now()}-diagram.png`;

  await uploadObjectToR2({
    bucket,
    key: imgKey,
    body: imgBytes,
    contentType: "image/png",
  });

  const imgHead = await headObjectFromR2({ bucket, key: imgKey });
  assert.equal(imgHead.exists, true, "Image must exist in storage");
  assert.equal(imgHead.contentType, "image/png");

  const imgGet = await getObjectFromR2({ bucket, key: imgKey });
  let imgChunks = 0;
  for await (const chunk of imgGet.body) {
    imgChunks += chunk.length;
  }
  assert.equal(imgChunks, imgBytes.length, "Image streamed bytes must match uploaded size");
  console.log("✓ Test 2 Passed: Image stream verified successfully.");

  // --- Test 3: Missing File Non-Existent Object (404 verification) ---
  console.log("\n[Test 3] Missing File / Non-Existent Key Handling...");
  const missingKey = `notes/non_existent_${Date.now()}.pdf`;
  const missingHead = await headObjectFromR2({ bucket, key: missingKey });
  assert.equal(missingHead.exists, false, "Non-existent key must return exists: false");
  console.log("✓ Test 3 Passed: Missing file correctly returns 404 without crashing.");

  // --- Test 4: Key Sanitization & Canonical Resolution ---
  console.log("\n[Test 4] Key Canonicalization & Alias Normalization...");
  const messyKey1 = `///${bucket}//notes/${studentId}/test.pdf?token=123#page=2`;
  const clean1 = sanitizeKey(messyKey1, bucket);
  assert.equal(clean1, `notes/${studentId}/test.pdf`);

  const messyKey2 = encodeURIComponent(`notes/${studentId}/chapter 1 note.pdf`);
  const clean2 = sanitizeKey(messyKey2, bucket);
  assert.equal(clean2, `notes/${studentId}/chapter_1_note.pdf`);

  const mimeCheck1 = getMimeType("test.pdf");
  assert.equal(mimeCheck1, "application/pdf");
  const mimeCheck2 = getMimeType("photo.webp");
  assert.equal(mimeCheck2, "image/webp");
  console.log("✓ Test 4 Passed: Canonical key resolution validated.");

  // --- Test 5: Cleanup test objects ---
  console.log("\n[Test 5] Cleaning up test artifacts...");
  await deleteObjectFromR2({ bucket, key: pdfKey });
  await deleteObjectFromR2({ bucket, key: imgKey });
  console.log("✓ Test 5 Passed: Cleanup complete.");

  console.log("\n=== ALL TOPIC NOTES PIPELINE TESTS PASSED SUCCESSFULLY (v6.0.0) ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ [PDF Storage Flow Test] FAILED");
  console.error(err);
  process.exit(1);
});

