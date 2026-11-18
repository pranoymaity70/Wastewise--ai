require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Please upload a valid image file."));
    }
    cb(null, true);
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, configured: Boolean(process.env.GEMINI_API_KEY) });
});

app.post("/api/classify", upload.single("image"), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "Gemini API key is missing. Add GEMINI_API_KEY in Render Environment settings."
      });
    }
    if (!req.file) return res.status(400).json({ error: "Choose an image first." });

    const prompt = `You are an expert waste-sorting assistant. Inspect the supplied image and identify the main visible waste item. Return valid JSON matching the supplied schema. Choose the most appropriate category. If the image does not clearly show waste, use item "No clear waste item detected", category "Uncertain", confidence 0, and explain that a clearer image is needed. Do not claim certainty when the image is ambiguous. Keep advice practical and safety-conscious. Bin colours and disposal rules vary by municipality, so phrase bin guidance as a general recommendation.`;

    const schema = {
      type: "object",
      properties: {
        item: { type: "string" },
        category: {
          type: "string",
          enum: ["Wet Waste", "Dry Waste", "Recyclable", "Food Waste", "Hazardous", "Uncertain"]
        },
        bin: { type: "string" },
        confidence: { type: "integer" },
        reason: { type: "string" },
        disposal: { type: "array", items: { type: "string" } },
        reusable: { type: "string" }
      },
      required: ["item", "category", "bin", "confidence", "reason", "disposal", "reusable"]
    };

    // Gemini 2.5 Flash is restricted for some new API users. Use the current
    // Gemini 3.8 Flash model through the Interactions API for multimodal input.
    const apiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        "Api-Revision": "2026-05-20"
      },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        store: false,
        input: [
          { type: "text", text: prompt },
          {
            type: "image",
            data: req.file.buffer.toString("base64"),
            mime_type: req.file.mimetype
          }
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema
        }
      })
    });

    const payload = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      const message = payload?.error?.message || `Gemini API request failed (${apiResponse.status}).`;
      return res.status(502).json({ error: message });
    }

    const outputText = payload?.output_text || (payload?.steps || [])
      .filter(step => step.type === "model_output")
      .flatMap(step => step.content || [])
      .filter(part => part.type === "text")
      .map(part => part.text || "")
      .join("\n")
      .trim();

    if (!outputText) {
      return res.status(502).json({ error: "Gemini returned no classification. Please try another image." });
    }

    let result;
    try {
      result = JSON.parse(outputText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } catch {
      return res.status(502).json({ error: "Gemini's response could not be read as JSON. Please try again." });
    }

    const allowed = ["Wet Waste", "Dry Waste", "Recyclable", "Food Waste", "Hazardous", "Uncertain"];
    if (!allowed.includes(result.category)) result.category = "Uncertain";
    result.confidence = Math.max(0, Math.min(100, Number(result.confidence) || 0));
    if (!Array.isArray(result.disposal)) result.disposal = [];
    res.json(result);
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Image is too large. Maximum size is 8 MB." });
    }
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return res.status(504).json({ error: "Gemini took too long to respond. Please try again." });
    }
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Upload error." });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`WasteWise AI running on port ${port}`));
