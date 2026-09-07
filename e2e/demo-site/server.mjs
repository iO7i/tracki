import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DEMO_PORT ?? 4321);
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };

// Tiny static server for the demo store. SPA-style: unknown paths fall to index.
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!extname(file)) file = "/index.html";
  try {
    const body = await readFile(join(here, "public", file));
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "text/plain" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, () => {
  console.info(`demo store on http://localhost:${PORT}`);
});
