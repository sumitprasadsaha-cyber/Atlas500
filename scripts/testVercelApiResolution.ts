import { strict as assert } from "node:assert";

async function run() {
  console.log("=== Testing Vercel API Module Resolution & Endpoint Initialization ===");

  // 1. Test Barrel & Lib resolution
  console.log("[1/6] Loading api/_lib modules...");
  const lib = await import("../api/_lib/index.js");
  assert.ok(typeof lib.sendSuccess === "function", "sendSuccess must be exported");
  assert.ok(typeof lib.sendError === "function", "sendError must be exported");
  assert.ok(typeof lib.validateAction === "function", "validateAction must be exported");
  assert.ok(typeof lib.uploadObjectToR2 === "function", "uploadObjectToR2 must be exported");
  assert.ok(typeof lib.HttpError === "function", "HttpError must be exported");
  console.log("✓ api/_lib barrel resolved successfully.");

  // 2. Test api/storage.ts
  console.log("[2/6] Loading api/storage.ts...");
  const storageModule = await import("../api/storage.js");
  assert.ok(typeof storageModule.default === "function", "api/storage default handler must be a function");
  
  // Mock request/response to test GET /api/storage execution
  let statusCode = 0;
  let jsonResult: any = null;
  let headersSent: Record<string, string> = {};

  const mockRes: any = {
    setHeader: (k: string, v: string) => { headersSent[k] = v; },
    status: (code: number) => {
      statusCode = code;
      return mockRes;
    },
    json: (data: any) => {
      jsonResult = data;
      return mockRes;
    },
    end: () => mockRes,
  };

  const mockReq: any = {
    method: "GET",
    headers: {},
    query: { action: "exists", key: "test_check.pdf" },
  };

  await storageModule.default(mockReq, mockRes);
  assert.ok(statusCode === 200, `Expected 200 status, got ${statusCode}`);
  assert.ok(jsonResult !== null, "Expected JSON response from api/storage");
  console.log(`✓ api/storage.ts executed successfully (result: ${JSON.stringify(jsonResult)})`);

  // 3. Test api/r2 sub-routes
  console.log("[3/6] Loading api/r2 subroutes (download, upload, signed-url, verify)...");
  const r2Download = await import("../api/r2/download.js");
  const r2Upload = await import("../api/r2/upload.js");
  const r2SignedUrl = await import("../api/r2/signed-url.js");
  const r2Verify = await import("../api/r2/verify.js");
  assert.ok(typeof r2Download.default === "function");
  assert.ok(typeof r2Upload.default === "function");
  assert.ok(typeof r2SignedUrl.default === "function");
  assert.ok(typeof r2Verify.default === "function");
  console.log("✓ api/r2 subroutes loaded successfully.");

  // 4. Test api/files/download.ts
  console.log("[4/6] Loading api/files/download.ts...");
  const filesDownload = await import("../api/files/download.js");
  assert.ok(typeof filesDownload.default === "function");
  console.log("✓ api/files/download loaded successfully.");

  // 5. Test api/health.ts, api/notes.ts, api/practice-tests.ts, api/auth.ts, api/students.ts
  console.log("[5/6] Loading remaining API endpoints...");
  const health = await import("../api/health.js");
  const notes = await import("../api/notes.js");
  const practiceTests = await import("../api/practice-tests.js");
  const auth = await import("../api/auth.js");
  const students = await import("../api/students.js");

  assert.ok(typeof health.default === "function");
  assert.ok(typeof notes.default === "function");
  assert.ok(typeof practiceTests.default === "function");
  assert.ok(typeof auth.default === "function");
  assert.ok(typeof students.default === "function");
  console.log("✓ All remaining API endpoints loaded successfully.");

  // 6. Test GET /api/health execution
  console.log("[6/6] Executing GET /api/health handler...");
  let healthCode = 0;
  let healthJson: any = null;
  const mockHealthRes: any = {
    setHeader: () => {},
    status: (code: number) => {
      healthCode = code;
      return mockHealthRes;
    },
    json: (data: any) => {
      healthJson = data;
      return mockHealthRes;
    },
    end: () => mockHealthRes,
  };
  await health.default({ method: "GET", headers: {}, query: {} }, mockHealthRes);
  assert.ok(healthCode === 200);
  assert.equal(healthJson?.status, "healthy");
  console.log("✓ GET /api/health executed successfully.");

  console.log("\n=== ALL VERCEL API MODULE RESOLUTION TESTS PASSED (100% SUCCESS) ===");
}

run().catch((err) => {
  console.error("❌ Test Failed:", err);
  process.exit(1);
});
