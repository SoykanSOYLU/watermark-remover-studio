import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

// === SECURITY HARDENING & ABUSE PROTECTION MIDDLEWARES ===

// 1. Disable information disclosure (Express fingerprinting) to stop automated vulnerability scanners
app.disable("x-powered-by");

// 2. Set secure standard HTTP Response Headers to harden client sessions
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// 3. Robust In-Memory Rate Limiting middleware
// Secures the detection API route from automated fuzzing, scrape attacks, and high model expense depletion
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MIN = 25;    // Safe threshold for a single developer/user context

app.use("/api/detect-watermark", (req, res, next) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
  const ipKey = Array.isArray(ip) ? ip[0] : ip;
  const now = Date.now();

  const rateInfo = rateLimitStore.get(ipKey);
  if (!rateInfo || now > rateInfo.resetTime) {
    rateLimitStore.set(ipKey, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }

  if (rateInfo.count >= MAX_REQUESTS_PER_MIN) {
    return res.status(429).json({
      error: "Güvenlik Sınırı (Rate Limit): Dakikada çok fazla işlem yapıldı. Lütfen otomatik istekleri ve aşırı maliyeti engellemeye yönelik bu koruma kapsamında 1 dakika bekleyip tekrar deneyin.",
    });
  }

  rateInfo.count++;
  next();
});

// Allow large payloads for high-resolution images (secured via rate limit above)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Lazy init of GoogleGenAI or safe check
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// AI Detection endpoint
app.post("/api/detect-watermark", async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    
    // Strict Input Validation
    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "No valid image content provided or invalid parameter format." });
    }

    // Limit base64 input length strictly to avoid high heap allocation/DoS (max string length ~70M characters for 50MB)
    if (image.length > 70 * 1024 * 1024) {
      return res.status(400).json({ error: "Image file exceeds maximum permitted raw payload size." });
    }

    // Validate mime-type to avoid directory traversal or script execution injections via API boundaries
    const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (mimeType && !allowedMimeTypes.includes(mimeType.toLowerCase())) {
      return res.status(400).json({ error: "Unsupported image format. Only JPEG, PNG, or WEBP are permitted for security-validated detection." });
    }

    const ai = getGenAIClient();
    if (!ai) {
      return res.status(400).json({
        error: "Gemini API key is not configured. Please add GEMINI_API_KEY in the Secrets panel, or paint the watermark using the manual brush tool.",
        isConfigError: true
      });
    }

    // Prepare the image part safely
    const cleanBase64 = image.replace(/^data:image\/\w+;base64,/, "");
    const imagePart = {
      inlineData: {
        data: cleanBase64,
        mimeType: mimeType || "image/jpeg",
      },
    };

    const promptText = 
      "Analyze the image and locate any prominent watermarks, trademark logos, copyright text overlays, date stamps, camera signatures, or filigrans. " +
      "For each detected item, output a small name/label and its coordinates in a bounding box model [ymin, xmin, ymax, xmax] as values from 0 to 100. " +
      "Values represent percentage of distance from top-left. For example, [80, 75, 95, 95] is a bottom-right corner watermark.";

    // Call Gemini 3.5 Flash
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [imagePart, { text: promptText }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            watermarks: {
              type: Type.ARRAY,
              description: "Boundaries of watermarks, signatures, copyright marks, or stamps detected in the image.",
              items: {
                type: Type.OBJECT,
                properties: {
                  label: {
                    type: Type.STRING,
                    description: "The name of the detected watermark pattern, stamp, text layer, or copyright info.",
                  },
                  box: {
                    type: Type.ARRAY,
                    description: "Bounding box coordinates sorted as [ymin, xmin, ymax, xmax] ranging from 0 to 100.",
                    items: {
                      type: Type.INTEGER,
                    },
                  },
                },
                required: ["label", "box"],
              },
            },
          },
          required: ["watermarks"],
        },
      },
    });

    const textOutput = response.text || "{\"watermarks\": []}";
    const data = JSON.parse(textOutput);
    return res.json({ watermarks: data.watermarks || [] });
  } catch (error: any) {
    console.error("Watermark detection error:", error);
    return res.status(500).json({
      error: error.message || "An unexpected error occurred during AI analysis.",
    });
  }
});

async function main() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
    console.log(`Watermark Remover Server running at http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
});
