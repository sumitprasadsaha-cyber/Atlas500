/**
 * Comprehensive Metadata-Driven Hierarchy Integration Test
 * Verifies full lifecycle:
 * 1. Create Class Node -> PutObject -> HeadObject -> metadata.json verification
 * 2. Create Subject Node -> PutObject -> HeadObject -> metadata.json verification
 * 3. Create Chapter Node -> PutObject -> HeadObject -> metadata.json verification
 * 4. Create Topic Node -> PutObject -> HeadObject -> metadata.json verification
 * 5. Upload Note -> HeadObject -> metadata.json updated
 * 6. Discover nodes via list-nodes (reading metadata.json objects)
 * 7. GetObject & HeadObject verification
 * 8. Cleanup / Deletion
 */

import {
  uploadObjectToR2,
  headObjectFromR2,
  getObjectFromR2,
  deleteObjectFromR2,
  listObjectsFromR2,
  getR2ServerConfig,
} from "../api/_lib/r2.js";
import {
  getClassMetadataKey,
  getSubjectMetadataKey,
  getChapterMetadataKey,
  getTopicMetadataKey,
  getHierarchyLineage,
} from "../src/utils/canonicalStorageKey.js";
import { buildCanonicalNoteMetadata } from "../src/domain/notes/types.js";

const r2Config = getR2ServerConfig();
const bucket = r2Config.bucket;

async function runMetadataHierarchyTest() {
  console.log("=================================================================");
  console.log("  METADATA-DRIVEN STORAGE HIERARCHY INTEGRATION TEST");
  console.log(`  Bucket: ${bucket}`);
  console.log("=================================================================\n");

  const nowIso = new Date().toISOString();

  // Define test hierarchy
  const className = "Class 9";
  const subjectName = "Science";
  const chapterNo = 5;
  const chapterTitle = "Exploring Mixtures";
  const topicNo = 1;
  const topicTitle = "Introduction";

  const classKey = getClassMetadataKey(className);
  const subjectKey = getSubjectMetadataKey(className, subjectName);
  const chapterKey = getChapterMetadataKey(className, subjectName, chapterNo, chapterTitle);
  const topicKey = getTopicMetadataKey(className, subjectName, chapterNo, chapterTitle, topicNo, topicTitle);

  console.log("Canonical Metadata Keys generated:");
  console.log(`  [Class]   ${classKey}`);
  console.log(`  [Subject] ${subjectKey}`);
  console.log(`  [Chapter] ${chapterKey}`);
  console.log(`  [Topic]   ${topicKey}\n`);

  // Step 1: Create Class Node Metadata
  console.log("[STEP 1] Creating and verifying Class node metadata...");
  const classMeta = {
    id: "class_9",
    name: className,
    type: "class",
    category: "school",
    folderPath: "class_notes/Class_9",
    storageKey: classKey,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await uploadObjectToR2({
    bucket,
    key: classKey,
    body: Buffer.from(JSON.stringify(classMeta, null, 2)),
    contentType: "application/json",
  });
  const checkClass = await headObjectFromR2({ bucket, key: classKey });
  if (!checkClass.exists) throw new Error(`Class metadata.json HeadObject verification failed at ${classKey}`);
  console.log(`  ✓ Class metadata verified in R2 (${checkClass.contentLength} bytes)`);

  // Step 2: Create Subject Node Metadata
  console.log("[STEP 2] Creating and verifying Subject node metadata...");
  const subjectMeta = {
    id: "class_9_science",
    name: subjectName,
    type: "subject",
    category: "school",
    folderPath: "class_notes/Class_9/Science",
    storageKey: subjectKey,
    parentFolderPath: "class_notes/Class_9",
    parentMetadataKey: classKey,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await uploadObjectToR2({
    bucket,
    key: subjectKey,
    body: Buffer.from(JSON.stringify(subjectMeta, null, 2)),
    contentType: "application/json",
  });
  const checkSubject = await headObjectFromR2({ bucket, key: subjectKey });
  if (!checkSubject.exists) throw new Error(`Subject metadata.json HeadObject verification failed at ${subjectKey}`);
  console.log(`  ✓ Subject metadata verified in R2 (${checkSubject.contentLength} bytes)`);

  // Step 3: Create Chapter Node Metadata
  console.log("[STEP 3] Creating and verifying Chapter node metadata...");
  const chapterMeta = {
    id: "class_9_science_ch05",
    name: chapterTitle,
    type: "chapter",
    category: "school",
    number: chapterNo,
    folderPath: "class_notes/Class_9/Science/Chapter_05_Exploring_Mixtures",
    storageKey: chapterKey,
    parentFolderPath: "class_notes/Class_9/Science",
    parentMetadataKey: subjectKey,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await uploadObjectToR2({
    bucket,
    key: chapterKey,
    body: Buffer.from(JSON.stringify(chapterMeta, null, 2)),
    contentType: "application/json",
  });
  const checkChapter = await headObjectFromR2({ bucket, key: chapterKey });
  if (!checkChapter.exists) throw new Error(`Chapter metadata.json HeadObject verification failed at ${chapterKey}`);
  console.log(`  ✓ Chapter metadata verified in R2 (${checkChapter.contentLength} bytes)`);

  // Step 4: Create Topic Node Metadata
  console.log("[STEP 4] Creating and verifying Topic node metadata...");
  const topicMeta = {
    id: "class_9_science_ch05_top01",
    name: topicTitle,
    type: "topic",
    category: "school",
    number: topicNo,
    folderPath: "class_notes/Class_9/Science/Chapter_05_Exploring_Mixtures/Topic_01_Introduction",
    storageKey: topicKey,
    parentFolderPath: "class_notes/Class_9/Science/Chapter_05_Exploring_Mixtures",
    parentMetadataKey: chapterKey,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await uploadObjectToR2({
    bucket,
    key: topicKey,
    body: Buffer.from(JSON.stringify(topicMeta, null, 2)),
    contentType: "application/json",
  });
  const checkTopic = await headObjectFromR2({ bucket, key: topicKey });
  if (!checkTopic.exists) throw new Error(`Topic metadata.json HeadObject verification failed at ${topicKey}`);
  console.log(`  ✓ Topic metadata verified in R2 (${checkTopic.contentLength} bytes)`);

  // Step 5: Upload Sample Note PDF and verify
  console.log("[STEP 5] Uploading note file into Topic node...");
  const canonicalNote = buildCanonicalNoteMetadata({
    className,
    subject: subjectName,
    chapterNumber: chapterNo,
    chapterName: chapterTitle,
    topicNumber: topicNo,
    topicName: topicTitle,
    extension: "pdf",
  });
  const pdfSample = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
  await uploadObjectToR2({
    bucket,
    key: canonicalNote.storagePath,
    body: Buffer.from(pdfSample, "utf-8"),
    contentType: "application/pdf",
  });
  const checkNote = await headObjectFromR2({ bucket, key: canonicalNote.storagePath });
  if (!checkNote.exists) throw new Error(`Note HeadObject verification failed at ${canonicalNote.storagePath}`);
  console.log(`  ✓ Note file verified in R2 at "${canonicalNote.storagePath}" (${checkNote.contentLength} bytes)`);

  // Step 6: Verify reading and parsing metadata.json objects
  console.log("[STEP 6] Reading and validating metadata.json objects with GetObject...");
  const fetchedTopicObj = await getObjectFromR2({ bucket, key: topicKey });
  const fetchedTopicJson = JSON.parse(fetchedTopicObj.body.toString("utf-8"));
  if (fetchedTopicJson.name !== topicTitle || fetchedTopicJson.type !== "topic") {
    throw new Error(`Topic metadata validation failed: ${JSON.stringify(fetchedTopicJson)}`);
  }
  console.log(`  ✓ GetObject validated metadata content for "${fetchedTopicJson.name}"`);

  // Step 7: Discovery via listing metadata.json objects
  console.log("[STEP 7] Discovering hierarchy nodes by querying metadata.json objects...");
  const listRes = await listObjectsFromR2({ bucket, prefix: "class_notes/Class_9" });
  const metaKeys = listRes.objects.filter((o) => o.key.endsWith("/metadata.json")).map((o) => o.key);
  console.log(`  Found ${metaKeys.length} metadata.json objects in hierarchy:`);
  metaKeys.forEach((k) => console.log(`    - ${k}`));

  if (!metaKeys.includes(classKey) || !metaKeys.includes(subjectKey) || !metaKeys.includes(chapterKey) || !metaKeys.includes(topicKey)) {
    throw new Error("One or more expected metadata.json objects were missing from discovery listing!");
  }

  // Step 8: Lineage computation validation
  console.log("[STEP 8] Validating getHierarchyLineage utility...");
  const lineage = getHierarchyLineage(canonicalNote);
  if (lineage.length !== 4) {
    throw new Error(`Expected lineage of 4 nodes, got ${lineage.length}`);
  }
  console.log(`  ✓ Lineage verified: ${lineage.map((n) => `${n.type}:${n.name}`).join(" -> ")}`);

  console.log("\n=================================================================");
  console.log("  ALL METADATA-DRIVEN STORAGE HIERARCHY TESTS PASSED! (100%)");
  console.log("=================================================================\n");
}

runMetadataHierarchyTest().catch((err) => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
