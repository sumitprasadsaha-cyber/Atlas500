import { downloadFileFromStorage, getResolvedViewUrl, getBucketName } from "./storageService";

/**
 * Downloads a file from storage directly to the user's device.
 */
export async function downloadFile(
  bucket: string,
  storagePath: string,
  fileName: string
): Promise<void> {
  return downloadFileFromStorage(bucket, storagePath, fileName);
}

export { downloadFileFromStorage };

/**
 * Obtains a fresh signed URL for a given storage path.
 */
export async function getFreshSignedUrl(
  bucket: string,
  storagePath: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  return getResolvedViewUrl(bucket, storagePath);
}
