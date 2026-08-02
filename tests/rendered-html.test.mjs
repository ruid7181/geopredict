import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the GeoPredict product experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>GeoPredict \| Place-aware AI for spatial prediction<\/title>/i);
  assert.match(html, /AI that knows/);
  assert.match(html, /Interactive GeoPredict product demonstration/);
  assert.match(html, /TabPFN-GSA/);
  assert.match(html, /GeoAggregator/);
  assert.match(html, /property="og:image" content="http:\/\/localhost(?::3000)?\/og\.png"/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the finished site free of starter preview code", async () => {
  const [page, layout, app, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/geopredict-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<GeoPredictApp \/>/);
  assert.match(layout, /generateMetadata/);
  assert.match(app, /seattle-housing-demo\.csv/);
  assert.match(app, /"prediction" \| "uncertainty" \| "error"/);
  assert.doesNotMatch(`${page}\n${layout}\n${app}\n${packageJson}`, /SkeletonPreview|codex-preview|react-loading-skeleton/);
});
