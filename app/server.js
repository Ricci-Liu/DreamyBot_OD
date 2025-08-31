const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post("/generate", async (req, res) => {
  try {
    // 1. 请求创建 prediction
    const prediction = await axios.post(
      "https://api.replicate.com/v1/predictions",
      {
        version: "8aeee50b868f06a1893e3b95a8bb639a8342e846836f3e0211d6a13c158505b1",
        input: req.body.input
      },
      {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const predictionId = prediction.data.id;

    // 2. 轮询 prediction 状态，直到完成
    let result;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const poll = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`
          }
        }
      );
      result = poll.data;
      if (result.status === "succeeded" || result.status === "failed") break;
    }

    // 3. 返回最终结果给前端
    res.json(result);

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to call Replicate API" });
  }
});

app.listen(3000, () => {
  console.log("Proxy server running on port 3000");
});
