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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function callGemini(model, apiKey, input, responseFormat) {
  const delays = [1500, 3500]; // retry only temporary capacity/server errors
  let lastError = "The AI service is temporarily unavailable.";

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    let response;
    try {
      response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        signal: AbortSignal.timeout(90000),
        body: JSON.stringify({
          model,
          store: false,
          input,
          response_format: responseFormat
        })
      });
    } catch (err) {
      lastError = err.name === "TimeoutError" || err.name === "AbortError"
        ? "Gemini took too long to respond. Please try again."
        : (err.message || "Could not connect to Gemini.");
      // Network errors/timeouts may be transient; retry with the same delay schedule.
      if (attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      return { ok: false, status: 504, error: lastError };
    }

    const payload = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, payload, model };

    lastError = payload?.error?.message || `Gemini request failed (${response.status}).`;
    // 503 = temporary model capacity; 500/502/504 can also be transient.
    if ([500, 502, 503, 504].includes(response.status) && attempt < delays.length) {
      await sleep(delays[attempt]);
      continue;
    }
    return { ok: false, status: response.status, error: lastError };
  }
  return { ok: false, status: 503, error: lastError };
}

app.post("/api/classify", upload.single("image"), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "Gemini API key is missing. Add GEMINI_API_KEY in Render Environment settings."
      });
    }
    if (!req.file) return res.status(400).json({ error: "Choose an image first." });

    const prompt = `You are an expert waste-sorting assistant. Inspect the supplied image and identify the main visible waste item. Return valid JSON matching the schema. Choose the most appropriate category. If the image does not clearly show waste, use item "No clear waste item detected", category "Uncertain", confidence 0, and explain that a clearer image is needed. Do not claim certainty when the image is ambiguous. Keep advice practical and safety-conscious. Bin colours and disposal rules vary by municipality, so phrase bin guidance as a general recommendation.`;
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

    const input = [
      { type: "text", text: prompt },
      {
        type: "image",
        data: req.file.buffer.toString("base64"),
        mime_type: req.file.mimetype
      }
    ];
    const responseFormat = { type: "text", mime_type: "application/json", schema };

    // Main model: Gemini 3.8 Flash. If it remains overloaded after retries,
    // automatically fall back to Gemini 3.5 Flash-Lite, which also accepts images.
    let result = await callGemini("gemini-3.8-flash", apiKey, input, responseFormat);
    if (!result.ok && [500, 502, 503, 504].includes(result.status)) {
      result = await callGemini("gemini-3.5-flash-lite", apiKey, input, responseFormat);
    }
    if (!result.ok) {
      const message = result.status === 503
        ? "Gemini is busy right now. Please try again in a few minutes."
        : result.error;
      return res.status(502).json({ error: message });
    }

    const payload = result.payload;
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

    let classification;
    try {
      classification = JSON.parse(outputText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } catch {
      return res.status(502).json({ error: "Gemini's response could not be read as JSON. Please try again." });
    }

    const allowed = ["Wet Waste", "Dry Waste", "Recyclable", "Food Waste", "Hazardous", "Uncertain"];
    if (!allowed.includes(classification.category)) classification.category = "Uncertain";
    classification.confidence = Math.max(0, Math.min(100, Number(classification.confidence) || 0));
    if (!Array.isArray(classification.disposal)) classification.disposal = [];
    res.json(classification);
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Image is too large. Maximum size is 8 MB." });
    }
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
});

app.use((err, _req, res, _next) => res.status(400).json({ error: err.message || "Upload error." }));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`WasteWise AI running on port ${port}`));

