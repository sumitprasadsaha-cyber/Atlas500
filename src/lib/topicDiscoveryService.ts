/**
 * Cloudflare R2 Topic Discovery Service
 * 
 * Automatically discovers, enumerates, and normalizes topic notes
 * directly from Cloudflare R2 bucket paths.
 */

import { discoverR2Topics, listR2Nodes, listObjects } from "./r2Client";
import { getR2BucketName } from "./r2Client";
import type { ClassNote } from "../types";

/**
 * Normalizes a topic note discovered from Cloudflare R2 into a valid ClassNote.
 */
export function normalizeDiscoveredTopicNote(raw: any): ClassNote {
  const isUPSC = Boolean(
    raw.isUPSC ||
    raw.category === "upsc" ||
    (typeof raw.classGrade === "string" && raw.classGrade.toUpperCase().includes("UPSC")) ||
    raw.gsPaper
  );

  const cleanClassGrade = raw.classGrade || (isUPSC ? "UPSC" : "Class 10");
  const cleanSubject = raw.subject || "General";
  const chNo = raw.chapterNo !== undefined ? Number(raw.chapterNo) : (raw.moduleNo !== undefined ? Number(raw.moduleNo) : 1);
  const chName = raw.chapterName || raw.moduleName || `Chapter ${chNo}`;
  const tNo = raw.topicNo !== undefined ? Number(raw.topicNo) : 1;
  const tName = raw.topicName || `Topic ${tNo}`;

  // Safe non-destructive title cleanup:
  // Strip only explicit prefix like "Topic 1:" or "Topic 01 - ", never remove parts of real words
  const cleanTopicTitle = String(tName)
    .replace(/^[\(\[\{-]?\s*(?:topic|part|pt)\b\.?[\s_]*\d+[\)\]\}]?[\s_.:–\-]*\s*/i, "")
    .replace(/^[\(\[\{-]?\s*(?:topic|part|pt)\b\.?[\)\]\}]?[\s_]*[:–\-]\s*/i, "")
    .replace(/_/g, " ")
    .trim() || String(tName).replace(/_/g, " ");

  const cleanChTitle = String(chName)
    .replace(/^[\(\[\{-]?\s*(?:chapter|ch|module|mod)\b\.?[\s_]*\d+[\)\]\}]?[\s_.:–\-]*\s*/i, "")
    .replace(/^[\(\[\{-]?\s*(?:chapter|ch|module|mod)\b\.?[\)\]\}]?[\s_]*[:–\-]\s*/i, "")
    .replace(/_/g, " ")
    .trim() || String(chName).replace(/_/g, " ");

  const partLabel = tNo && cleanTopicTitle ? `Topic ${tNo} : ${cleanTopicTitle}` : (cleanTopicTitle || `Topic ${tNo}`);

  const storageKey = raw.storagePath || raw.storageKey || raw.objectKey || "";
  const bucket = raw.bucket || getR2BucketName();
  const downloadUrl = raw.downloadUrl || `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(storageKey)}`;

  const fileName = raw.fileName || (storageKey ? storageKey.split("/").pop() : "note.pdf") || "note.pdf";
  const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(fileName);

  const id = raw.id || `r2_${storageKey.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()}`;

  return {
    id,
    noteId: id,
    isUPSC,
    type: isUPSC ? "upsc" : "school",
    classGrade: cleanClassGrade,
    className: cleanClassGrade,
    subject: cleanSubject,
    subjectName: cleanSubject,
    chapterNo: chNo,
    chapterName: cleanChTitle,
    chapterNumber: chNo,
    chapterTitle: cleanChTitle,
    topicNo: tNo,
    topicNumber: tNo,
    topicName: cleanTopicTitle,
    topicTitle: cleanTopicTitle,
    partLabel,
    paper: raw.gsPaper,
    generalStudiesPaper: raw.gsPaper,
    gs_paper: raw.gsPaper,
    moduleNo: isUPSC ? chNo : undefined,
    moduleNumber: isUPSC ? chNo : undefined,
    moduleName: isUPSC ? cleanChTitle : undefined,
    moduleTitle: isUPSC ? cleanChTitle : undefined,
    storagePath: storageKey,
    storageKey,
    objectKey: storageKey,
    pdfUrl: downloadUrl,
    downloadUrl,
    pdfFileName: fileName,
    fileName,
    storedFilename: fileName,
    fileType: isImage ? "image" : "pdf",
    fileSize: raw.fileSize || 0,
    createdAt: raw.lastModified || new Date().toISOString(),
    uploadedAt: raw.lastModified || new Date().toISOString(),
    visibility: "all",
  };
}

/**
 * Discovers topic notes directly from Cloudflare R2 bucket.
 */
export async function discoverTopicNotesFromR2(params?: {
  category?: "school" | "upsc" | "all";
  classGrade?: string;
  className?: string;
  gsPaper?: string;
  generalStudiesPaper?: string;
  subject?: string;
  chapterNo?: number | string;
  moduleNo?: number | string;
  prefix?: string;
}): Promise<ClassNote[]> {
  try {
    const res = await discoverR2Topics(params);
    if (res && Array.isArray(res.topics)) {
      return res.topics.map(normalizeDiscoveredTopicNote);
    }
  } catch (err) {
    console.warn("[TopicDiscoveryService] Direct discovery failed, falling back to node listing:", err);
  }

  // Fallback: Query listR2Nodes
  try {
    const nodeRes = await listR2Nodes({
      category: params?.category || "all",
      prefix: params?.prefix,
    });
    if (nodeRes && Array.isArray(nodeRes.nodes)) {
      const topicNodes = nodeRes.nodes.filter((n) => n.folderPath && n.folderPath.includes("Topic_"));
      return topicNodes.map((n) =>
        normalizeDiscoveredTopicNote({
          storagePath: `${n.folderPath}/note.pdf`,
          storageKey: `${n.folderPath}/note.pdf`,
          topicName: n.name,
          lastModified: n.lastModified,
        })
      );
    }
  } catch (err) {
    console.warn("[TopicDiscoveryService] Node listing fallback failed:", err);
  }

  return [];
}
