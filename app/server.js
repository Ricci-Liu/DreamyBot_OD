// server.js
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const TRELLIS_VERSION =
  "e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c";

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
        version: "imagen-4.0-ultra-generate-001",
        input,
      },
      {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const predictionId = createResp.data.id;

    // 2) poll until done (max ~120s)
    const started = Date.now();
    let status = createResp.data.status;
    let last = createResp.data;

    while (
      status !== "succeeded" &&
      status !== "failed" &&
      status !== "canceled"
    ) {
      if (Date.now() - started > 120000) {
        return res
          .status(504)
          .json({ error: "Replicate polling timeout", last });
      }
      await new Promise((r) => setTimeout(r, 2000));
      const pollResp = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          },
          timeout: 15000,
        }
      );
      last = pollResp.data;
      status = last.status;
    }

    if (status === "succeeded") {
      return res.json(last); // 保留原始返回，前端可从 last.output 取结果
    } else {
      return res
        .status(502)
        .json({ error: `Replicate ${status}`, detail: last });
    }
  } catch (err) {
    const detail = err.response?.data || err.message || "unknown_error";
    console.error("Replicate error:", detail);
    return res
      .status(500)
      .json({ error: "Failed to call Replicate API", detail });
  }
});

// 图 -> 3D：用户在前端选定一张图片后，把图片 URL 传进来
app.post("/mesh", async (req, res) => {
  try {
    const { imageUrl, ...rest } = req.body || {};
    if (!imageUrl) {
      return res.status(400).json({ error: "Provide imageUrl" });
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });
    }

    // 1) 创建 trellis 预测
    const createResp = await axios.post(
      "https://api.replicate.com/v1/predictions",
      {
        version: TRELLIS_VERSION,
        input: {
          images: [imageUrl], // trellis 要求数组
          texture_size: 2048,
          mesh_simplify: 0.9,
          generate_model: true,
          save_gaussian_ply: true,
          ss_sampling_steps: 38,
          ...rest, // 可选：你想开放的调参也可以跟着传
        },
      },
      {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const predictionId = createResp.data.id;

    // 2) 轮询直至完成（3D可能久一点，这里给到180s）
    const started = Date.now();
    let status = createResp.data.status;
    let last = createResp.data;

    while (!["succeeded", "failed", "canceled"].includes(status)) {
      if (Date.now() - started > 180000) {
        return res.status(504).json({ error: "Trellis polling timeout", last });
      }
      await new Promise((r) => setTimeout(r, 2000));
      const pollResp = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          },
          timeout: 15000,
        }
      );
      last = pollResp.data;
      status = last.status;
    }

    if (status === "succeeded") {
      return res.json(last); // 前端从 last.output 里拿 3D 文件链接
    } else {
      return res.status(502).json({ error: `Trellis ${status}`, detail: last });
    }
  } catch (err) {
    const detail = err.response?.data || err.message || "unknown_error";
    console.error("Trellis error:", detail);
    return res.status(500).json({ error: "Failed to call Trellis", detail });
  }
});

// ---- listen on DO-provided port ----
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
