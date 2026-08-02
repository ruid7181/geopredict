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
  assert.match(html, /src="\/og\.png"/);
  assert.match(html, /Public-data demonstration/);
  assert.match(html, /1,000 public Seattle housing records/);
  assert.match(html, /Interactive GeoPredict product demonstration/);
  assert.match(html, /See more than a prediction/);
  assert.match(html, /GeoPredict in 18 seconds/);
  assert.match(html, /workflow-explainer\.mp4/);
  assert.match(html, /18 seconds \/ no audio/);
  assert.match(html, /Published benchmark evidence/);
  assert.match(html, /0\.919/);
  assert.match(html, /4\.6K/);
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
  assert.match(app, /\+proj=utm \+zone=10/);
  assert.match(app, /tile\.openstreetmap\.org/);
  assert.match(app, /Rui Deng.*Ziqi Li.*Mingshu Wang/s);
  assert.match(app, /Ziqi Li<\/strong><span>Research lead/);
  assert.match(app, /Mingshu Wang<\/strong><span>Research lead/);
  assert.match(app, /gaValue.*gaUncertainty.*gaError/s);
  assert.match(app, /<span>TabPFN-GSA<\/span>.*<span>GeoAggregator<\/span>/s);
  assert.match(app, /they are not benchmark claims/);
  assert.match(app, /AAAI-25 paper/);
  assert.match(app, /AAAI\/article\/view\/33259/);
  assert.match(app, /IJGIS study/);
  assert.match(app, /prefers-reduced-motion/);
  assert.match(app, /autoPlay muted loop playsInline controls/);
  assert.match(app, /workflow-explainer-poster\.png/);
  assert.doesNotMatch(app, /<canvas|bezierCurveTo/);
  assert.doesNotMatch(`${page}\n${layout}\n${app}\n${packageJson}`, /SkeletonPreview|codex-preview|react-loading-skeleton/);
});
