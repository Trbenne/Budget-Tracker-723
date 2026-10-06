const fs = require("fs");
const path = require("path");

const BUILD_ROOT = path.join(__dirname, "../build");

const MIME_BY_EXT = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

function contentTypeFor(filePath) {
  return (
    MIME_BY_EXT[path.extname(filePath).toLowerCase()] ||
    "application/octet-stream"
  );
}

function pathHasFileExtension(urlPathname) {
  const withoutQuery = urlPathname.split("?")[0].split("#")[0];
  const base = withoutQuery.replace(/^\/+/, "").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1;
}

function resolveBuildPath(urlPathname) {
  let relative = urlPathname || "/";
  if (relative === "/" || relative === "") {
    relative = "index.html";
  } else {
    relative = relative.replace(/^\/+/, "");
  }
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = path.join(BUILD_ROOT, normalized);
  const resolved = path.resolve(candidate);
  const rootResolved = path.resolve(BUILD_ROOT);
  if (
    !resolved.startsWith(rootResolved + path.sep) &&
    resolved !== rootResolved
  ) {
    return null;
  }
  return resolved;
}

function readFileResponse(filePath) {
  const data = fs.readFileSync(filePath);
  return new Response(data, {
    headers: { "Content-Type": contentTypeFor(filePath) },
  });
}

function notFound() {
  return new Response("Not found", { status: 404 });
}

function serveAppRequest(request) {
  const url = new URL(request.url);
  const filePath = resolveBuildPath(url.pathname);
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return readFileResponse(filePath);
  }
  if (pathHasFileExtension(url.pathname)) {
    return notFound();
  }
  const indexPath = path.join(BUILD_ROOT, "index.html");
  if (fs.existsSync(indexPath)) {
    return readFileResponse(indexPath);
  }
  return notFound();
}

module.exports = {
  BUILD_ROOT,
  serveAppRequest,
  contentTypeFor,
  pathHasFileExtension,
};
