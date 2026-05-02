const { onRequest } = require("firebase-functions/v2/https");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.bibleProxy = onRequest({ cors: true }, async (req, res) => {
  const { path } = req.query;
  if (!path) {
    return res.status(400).send("Path parameter is required");
  }

  // Validate path to prevent abuse (only bolls.life allowed)
  if (!path.startsWith("https://bolls.life/")) {
    return res.status(403).send("Forbidden: Only bolls.life URLs are supported");
  }

  try {
    const response = await fetch(path);
    if (!response.ok) {
      return res.status(response.status).send(`Upstream error: ${response.statusText}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).send("Internal Server Error");
  }
});
