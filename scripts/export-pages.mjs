import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-pages");
const basePath = (process.env.GITHUB_PAGES_BASE_PATH ?? "").replace(/\/$/, "");
const repository = process.env.GITHUB_REPOSITORY ?? "ruid7181/geopredict";
const [owner] = repository.split("/");

if (!basePath.startsWith("/") || basePath === "/") {
  throw new Error("GITHUB_PAGES_BASE_PATH must be a repository subpath such as /geopredict");
}

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("pages", `${Date.now()}`);
const { default: worker } = await import(workerUrl.href);
const response = await worker.fetch(
  new Request("https://pages.local/", {
    headers: {
      accept: "text/html",
      "x-forwarded-host": `${owner}.github.io`,
      "x-forwarded-proto": "https",
    },
  }),
  { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  { waitUntil() {}, passThroughOnException() {} },
);

if (!response.ok) throw new Error(`Static render failed with HTTP ${response.status}`);

const html = (await response.text()).replaceAll("/assets/_vinext_fonts/", `${basePath}/assets/_vinext_fonts/`);
if (!html.includes(`${basePath}/assets/`) || !html.includes(`${basePath}/video/workflow-explainer.mp4`)) {
  throw new Error(`Static render did not apply the GitHub Pages base path ${basePath}`);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, "dist/client"), output, { recursive: true });
await Promise.all([
  writeFile(resolve(output, "index.html"), html),
  writeFile(resolve(output, "404.html"), html),
  writeFile(resolve(output, ".nojekyll"), ""),
]);

console.log(`Exported GitHub Pages site to ${output}${basePath}`);
