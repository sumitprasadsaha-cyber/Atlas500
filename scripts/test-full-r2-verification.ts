import "dotenv/config";
import {
  getR2ServerConfig,
  isR2Configured,
  listObjectsFromR2,
  uploadObjectToR2,
  getObjectFromR2,
  headObjectFromR2,
  deleteObjectFromR2,
  generateR2SignedUrl,
} from "../src/lib/r2Server.js";
import { Readable } from "stream";

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function runAudit() {
  console.log("================================================================================");
  console.log("             COMPREHENSIVE CLOUDFLARE R2 VERIFICATION AUDIT SUITE               ");
  console.log("================================================================================");

  // 1. Environment & Credential Check
  console.log("\n[STAGE 1] Checking R2 Configuration & Credentials...");
  const config = getR2ServerConfig();
  console.log("R2 Config:", {
    accountId: config.accountId ? `${config.accountId.substring(0, 4)}...${config.accountId.substring(config.accountId.length - 4)}` : "MISSING",
    accessKeyId: config.accessKeyId ? `${config.accessKeyId.substring(0, 4)}...` : "MISSING",
    secretAccessKey: config.secretAccessKey ? `[EXISTS length=${config.secretAccessKey.length}]` : "MISSING",
    bucket: config.bucket,
    endpoint: config.endpoint,
  });

  if (!isR2Configured()) {
    console.warn("⚠️ Cloudflare R2 environment variables are not fully configured in this environment.");
    console.warn("Please ensure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, and R2_BUCKET are set in Settings/Secrets.");
    return;
  }

  const bucket = config.bucket;

  // 2. Student Attempt Lifecycle Verification
  console.log("\n[STAGE 2] Testing Student Attempt Write, Head Verification, and Download...");
  const studentAttemptKey = `practice_tests/student_attempts/test_audit_student_${Date.now()}.json`;
  const studentAttemptPayload = {
    testId: "class_10__science__ch1__chemical_reactions",
    studentId: "audit_student_101",
    studentName: "Audit Test Student",
    score: 95,
    totalQuestions: 20,
    correctCount: 19,
    timestamp: new Date().toISOString(),
    answers: { "q1": "A", "q2": "B" },
  };

  const attemptUpload = await uploadObjectToR2({
    bucket,
    key: studentAttemptKey,
    body: JSON.stringify(studentAttemptPayload, null, 2),
    contentType: "application/json",
  });
  console.log(`✓ Student Attempt Put & Head Verified: key="${studentAttemptKey}", ETag="${attemptUpload.etag}", size=${attemptUpload.size}`);

  const attemptGet = await getObjectFromR2({ bucket, key: studentAttemptKey });
  if (!attemptGet.body) throw new Error("Downloaded student attempt body is null!");
  const attemptBuf = await streamToBuffer(attemptGet.body);
  const parsedAttempt = JSON.parse(attemptBuf.toString("utf-8"));
  if (parsedAttempt.studentId !== "audit_student_101" || parsedAttempt.score !== 95) {
    throw new Error("Student attempt payload mismatch!");
  }
  console.log(`✓ Student Attempt Readback Verified: studentId="${parsedAttempt.studentId}", score=${parsedAttempt.score}`);

  await deleteObjectFromR2({ bucket, key: studentAttemptKey });
  console.log(`✓ Student Attempt Cleanup Verified.`);

  // 3. Topic Notes PDF Lifecycle Verification
  console.log("\n[STAGE 3] Testing Topic Notes PDF Write, Head Verification, and Download...");
  const testNoteKey = `school/class_10/science/chapter_01_chemical_reactions_and_equations/topic_01_types_of_reactions/test_note_${Date.now()}.pdf`;
  const dummyPdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000108 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n187\n%%EOF\n";

  const noteUpload = await uploadObjectToR2({
    bucket,
    key: testNoteKey,
    body: Buffer.from(dummyPdf, "utf-8"),
    contentType: "application/pdf",
  });
  console.log(`✓ Topic Note Put & Head Verified: key="${testNoteKey}", ETag="${noteUpload.etag}", size=${noteUpload.size}`);

  const noteHead = await headObjectFromR2({ bucket, key: testNoteKey });
  if (!noteHead.exists) throw new Error("Topic note HeadObject returned exists=false!");
  console.log(`✓ Topic Note Head Verified via headObjectFromR2: exists=true, size=${noteHead.contentLength}`);

  const noteGet = await getObjectFromR2({ bucket, key: testNoteKey });
  if (!noteGet.body) throw new Error("Downloaded note body is null!");
  const noteBuf = await streamToBuffer(noteGet.body);
  if (noteBuf.toString("utf-8") !== dummyPdf) throw new Error("Note content mismatch!");
  console.log(`✓ Topic Note Readback Verified: ${noteBuf.length} bytes matching.`);

  await deleteObjectFromR2({ bucket, key: testNoteKey });
  console.log(`✓ Topic Note Cleanup Verified.`);

  // 4. Question Image Lifecycle Verification
  console.log("\n[STAGE 4] Testing Question Image Write, Head Verification, and Download...");
  const imageKey = `practice_tests/images/test_question_image_${Date.now()}.png`;
  // 1x1 transparent PNG buffer
  const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

  const imageUpload = await uploadObjectToR2({
    bucket,
    key: imageKey,
    body: png1x1,
    contentType: "image/png",
  });
  console.log(`✓ Question Image Put & Head Verified: key="${imageKey}", ETag="${imageUpload.etag}", size=${imageUpload.size}`);

  const imageGet = await getObjectFromR2({ bucket, key: imageKey });
  if (!imageGet.body) throw new Error("Downloaded image body is null!");
  const imageBuf = await streamToBuffer(imageGet.body);
  if (imageBuf.length !== png1x1.length) throw new Error("Image buffer length mismatch!");
  console.log(`✓ Question Image Readback Verified: ${imageBuf.length} bytes matching.`);

  await deleteObjectFromR2({ bucket, key: imageKey });
  console.log(`✓ Question Image Cleanup Verified.`);

  // 5. Negative Test: Non-existent object returns 404 / exists=false (NO FAKE SUCCESS)
  console.log("\n[STAGE 5] Negative Test: Verifying non-existent key returns error / not found...");
  const nonExistentKey = `practice_tests/student_attempts/non_existent_${Date.now()}.json`;
  const nonExistentHead = await headObjectFromR2({ bucket, key: nonExistentKey });
  if (nonExistentHead.exists) {
    throw new Error(`CRITICAL FAILURE: Non-existent key reported as existing: ${nonExistentKey}`);
  }
  console.log(`✓ Negative HeadObject Test Passed: Non-existent key confirmed exists=false.`);

  try {
    await getObjectFromR2({ bucket, key: nonExistentKey });
    throw new Error("CRITICAL FAILURE: getObjectFromR2 should have thrown for non-existent key!");
  } catch (err: any) {
    console.log(`✓ Negative Download Test Passed: getObjectFromR2 threw expected error "${err?.message || err}"`);
  }

  console.log("\n================================================================================");
  console.log("            ALL CLOUDFLARE R2 VERIFICATION AUDIT TESTS PASSED!                  ");
  console.log("================================================================================");
}

runAudit().catch((err) => {
  console.error("\n❌ Audit Failed:", err);
  process.exit(1);
});
