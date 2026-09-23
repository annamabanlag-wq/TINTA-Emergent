const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 10000);
const DIST = path.join(process.cwd(), "frontend", "dist");
const BACKEND = process.env.TINTA_BACKEND_URL || "https://tinta-backend.onrender.com";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function safeFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const clean = path.posix.normalize(decoded).replace(/^\/+/, "");
  const full = path.join(DIST, clean);
  if (!full.startsWith(DIST)) return null;
  return full;
}

async function proxyApi(req, res) {
  const target = new URL(req.url, "http://localhost");
  const upstream = new URL(target.pathname + target.search, BACKEND);

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try {
      const response = await fetch(upstream, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
        redirect: "manual",
      });

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === "content-length") return;
        if (key.toLowerCase() === "location" && value.startsWith(BACKEND)) {
          value = value.replace(BACKEND, "");
        }
        res.setHeader(key, value);
      });
      const body = Buffer.from(await response.arrayBuffer());
      res.end(body);
    } catch (error) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ detail: "Backend proxy error" }));
    }
  });
}

function serveStatic(req, res) {
  const requested = safeFile(req.url || "/");
  let file = requested;

  if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.join(DIST, "index.html");
  }

  if (!fs.existsSync(file)) {
    res.statusCode = 503;
    res.end("TINTA frontend build is not available");
    return;
  }

  const ext = path.extname(file).toLowerCase();
  res.setHeader("content-type", MIME[ext] || "application/octet-stream");
  if (ext === ".html") {
    res.setHeader("cache-control", "no-cache");
  } else {
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
  }
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("ok");
    return;
  }

  if ((req.url || "").startsWith("/api/")) {
    proxyApi(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`TINTA public host listening on ${PORT}`);
});
