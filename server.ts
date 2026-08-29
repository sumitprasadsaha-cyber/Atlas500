import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { apiApp } from "./src/apiApp";
import { getR2ServerConfig, validateR2Environment, getR2S3Client } from "./src/lib/r2Server";

const app = express();
const PORT = 3000;

// Validate Cloudflare R2 Environment Variables on startup
try {
  console.log("[Server-Startup] Validating Cloudflare R2 environment configuration...");
  const validation = validateR2Environment(false);
  if (!validation.valid) {
    console.warn(`[Server-Startup] Warning: Missing Cloudflare R2 variables: ${validation.missing.join(", ")}`);
  } else {
    // Attempt S3Client initialization
    try {
      getR2S3Client();
      console.log(`[Server-Startup] Cloudflare R2 S3Client successfully initialized for bucket "${validation.config.bucket}"`);
    } catch (s3InitErr: any) {
      console.error("[Server-Startup] Failed to initialize Cloudflare R2 S3Client:", s3InitErr.message);
    }
  }
} catch (envErr: any) {
  console.error("[Server-Startup] R2 Environment Validation Exception:", envErr.message);
}

// Mount all API routes
app.use(apiApp);

// Vite Middleware & Static Production Handler
async function startServer() {
  try {
    if (process.env.NODE_ENV !== "production") {
      const hmrDisabled = process.env.DISABLE_HMR === "true";
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: hmrDisabled ? false : undefined,
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] Production-ready Applet running on http://localhost:${PORT}`);
      console.log(`[Server] Cloudflare R2 Bucket: ${getR2ServerConfig().bucket}`);
    });
  } catch (error) {
    console.error("[Server] Fatal bootstrap error:", error);
    process.exit(1);
  }
}

if (process.env.VERCEL !== "1") {
  startServer();
}

export default app;
