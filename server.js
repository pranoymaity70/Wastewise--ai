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
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: "Gemini API key is missing. Add it to your .env file and restart the app." });
    }
    if (!req.file) return res.status(400).json({ error: "Choose an image first." });

    const prompt = `You are an expert waste-sorting assistant. Inspect the supplied image and identify the main visible waste item. Return ONLY valid JSON, no markdown, using exactly this schema:
{
 "item": "short item name",
 "category": "Wet Waste | Dry Waste | Recyclable | Food Waste | Hazardous",
 "bin": "recommended bin colour/name",
 "confidence": 0,
 "reason": "brief visual explanation",
 "disposal": ["step 1", "step 2"],
 "reusable": "one practical reuse or recycling suggestion"
}
Choose the most appropriate category. If the image does not clearly show waste, set item to "No clear waste item detected", category to "Uncertain", confidence to 0, and explain that a clearer image is needed. Do not claim certainty when the image is ambiguous. Keep advice practical and safety-conscious.`;

    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(process.env.GEMINI_API_KEY);
    const apiResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: req.file.mimetype, data: req.file.buffer.toString("base64") } }
        ]}],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
      })
    });

    const payload = await apiResponse.json();
    if (!apiResponse.ok) {
      const message = payload?.error?.message || "Gemini request failed.";
      return res.status(apiResponse.status).json({ error: message });
    }
    const raw = payload?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
    if (!raw) return res.status(502).json({ error: "The AI returned no classification. Please try another image." });

    let result;
    try {
      result = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } catch {
      return res.status(502).json({ error: "The AI response could not be read. Please try again." });
    }
    const allowed = ["Wet Waste", "Dry Waste", "Recyclable", "Food Waste", "Hazardous", "Uncertain"];
    if (!allowed.includes(result.category)) result.category = "Uncertain";
    result.confidence = Math.max(0, Math.min(100, Number(result.confidence) || 0));
    res.json(result);
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Image is too large. Maximum size is 8 MB." });
    }
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
});

app.use((err, _req, res, _next) => res.status(400).json({ error: err.message || "Upload error." }));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`WasteWise AI running at http://localhost:${port}`));