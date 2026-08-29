import { apiApp } from "../src/apiApp";
import express from "express";
import http from "http";

async function runTests() {
  console.log("=== [TESTING SERVERLESS API ENDPOINTS] ===");

  const server = http.createServer(apiApp);
  await new Promise<void>((resolve) => server.listen(3001, resolve));

  const baseUrl = "http://localhost:3001";

  try {
    // 1. Health check
    console.log("1. Testing GET /api/r2/health...");
    const healthRes = await fetch(`${baseUrl}/api/r2/health`);
    const healthJson = await healthRes.json();
    console.log("   Status:", healthRes.status);
    console.log("   Body:", healthJson);
    if (healthRes.status !== 200) throw new Error("Health check failed");

    // 2. Signed URL generation
    console.log("2. Testing POST /api/r2/signed-url...");
    const signedRes = await fetch(`${baseUrl}/api/r2/signed-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: "academy-connect-files",
        key: "notes/student-test/test-note.pdf",
        expiresIn: 3600,
        operation: "getObject",
      }),
    });
    const signedJson = await signedRes.json();
    console.log("   Status:", signedRes.status);
    console.log("   Body:", signedJson);
    if (signedRes.status !== 200 || !signedJson.signedUrl) {
      throw new Error("Signed URL generation failed");
    }

    // 3. Direct route without /api prefix (in case Vercel rewrites to root)
    console.log("3. Testing POST /r2/signed-url (root mounted)...");
    const rootSignedRes = await fetch(`${baseUrl}/r2/signed-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: "academy-connect-files",
        key: "notes/student-test/test-note.pdf",
        expiresIn: 3600,
        operation: "getObject",
      }),
    });
    const rootSignedJson = await rootSignedRes.json();
    console.log("   Status:", rootSignedRes.status);
    if (rootSignedRes.status !== 200) throw new Error("Root mounted signed URL failed");

    console.log("=== ALL SERVERLESS API ENDPOINTS VERIFIED SUCCESSFULLY (HTTP 200) ===");
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
