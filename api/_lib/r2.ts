import {
  uploadObjectToR2,
  getObjectFromR2,
  generateR2SignedUrl,
  deleteObjectFromR2,
  deleteObjectsFromR2,
  listObjectsFromR2,
  headObjectFromR2,
  getR2ServerConfig,
  isR2Configured,
  getR2S3Client,
} from "../../src/lib/r2Server.js";
import { sanitizeKey } from "./utils.js";

export {
  uploadObjectToR2,
  getObjectFromR2,
  generateR2SignedUrl,
  deleteObjectFromR2,
  deleteObjectsFromR2,
  listObjectsFromR2,
  headObjectFromR2,
  getR2ServerConfig,
  isR2Configured,
  getR2S3Client,
  sanitizeKey,
};

export async function verifyR2ReadWrite(): Promise<{ canRead: boolean; canWrite: boolean; latencyMs: number }> {
  const startTime = Date.now();
  const testKey = `_health_test_${Date.now()}.json`;
  const bucket = getR2ServerConfig().bucket;

  try {
    // Test write
    await uploadObjectToR2({
      bucket,
      key: testKey,
      body: Buffer.from(JSON.stringify({ health: "ok", timestamp: new Date().toISOString() })),
      contentType: "application/json",
    });

    // Test read
    const obj = await getObjectFromR2({ bucket, key: testKey });
    const canRead = Boolean(obj.body);

    // Clean up
    await deleteObjectFromR2({ bucket, key: testKey });

    const latencyMs = Date.now() - startTime;
    return { canRead, canWrite: true, latencyMs };
  } catch (err) {
    // Attempt cleanup if possible
    try {
      await deleteObjectFromR2({ bucket, key: testKey });
    } catch {}
    return { canRead: false, canWrite: false, latencyMs: Date.now() - startTime };
  }
}
