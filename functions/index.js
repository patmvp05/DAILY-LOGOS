const { onRequest } = require("firebase-functions/v2/https");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.bibleProxy = onRequest({ cors: true }, async (req, res) => {
  const { path } = req.query;
  if (!path) {
    return res.status(400).send("Path parameter is required");
  }

  if (!path.startsWith("https://bolls.life/")) {
    return res.status(403).send("Forbidden: Only bolls.life URLs are supported");
  }

  try {
    const response = await fetch(path, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://bolls.life/',
        'Origin': 'https://bolls.life',
      },
    });
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
