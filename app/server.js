// server.js
const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Health checks
app.get("/health", (req, res) => res.status(200).send("ok"));
app.get("/", (req, res) => res.status(200).send("DreamyBot API ready"));

// Generate endpoint (proxy to Replicate)
app.post("/generate", async (req, res) => {
  try {
    const input = req.body?.input;
    if (!input) {
      return res.status(400).json({ error: "Missing 'input' in request body" });
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });
    }

    // 1) create prediction
    const createResp = await axios.post(
      "https://api.replicate.com/v1/predictions",
      {
        version: "8aeee50b868f06a1893e3b95a8bb639a8342e846836f3e0211d6a13c158505b1",
        input
      },
      {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const predictionId = createResp.data.id;

    // 2) poll until done (max ~120s)
    const started = Date.now();
    let status = createResp.data.status;
    let last = createResp.data;

    while (status !== "succeeded" && status !== "failed" && status !== "canceled") {
      if (Date.now() - started > 120000) {
        return res.status(504).json({ error: "Replicate polling timeout", last });
      }
      await new Promise(r => setTimeout(r, 2000));
      const pollResp = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        { headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` }, timeout: 15000 }
      );
      last = pollResp.data;
      status = last.status;
    }

    if (status === "succeeded") {
      return res.json(last);                 // 保留原始返回，前端可从 last.output 取结果
    } else {
      return res.status(502).json({ error: `Replicate ${status}`, detail: last });
    }
  } catch (err) {
    const detail = err.response?.data || err.message || "unknown_error";
    console.error("Replicate error:", detail);
    return res.status(500).json({ error: "Failed to call Replicate API", detail });
  }
});

// ---- listen on DO-provided port ----
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
