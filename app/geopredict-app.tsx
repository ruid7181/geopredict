"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Layer = "prediction" | "uncertainty" | "error";
type Route = "fast" | "custom";

type PlacePoint = {
  id: number;
  x: number;
  y: number;
  value: number;
  uncertainty: number;
  error: number;
  sqft: number;
  grade: number;
};

const layerMeta: Record<Layer, { label: string; low: string; high: string }> = {
  prediction: { label: "Prediction", low: "Lower", high: "Higher" },
  uncertainty: { label: "Uncertainty", low: "More certain", high: "Less certain" },
  error: { label: "Validation error", low: "Lower", high: "Higher" },
};

const palettes: Record<Layer, string[]> = {
  prediction: ["#143d3a", "#237166", "#58a88d", "#c1ca6c", "#f1c14f", "#ed6b40"],
  uncertainty: ["#f0eee3", "#d5dbb4", "#a6c291", "#65a58e", "#327c79", "#18545c"],
  error: ["#f4f0e8", "#f5d7a3", "#efa25f", "#df6848", "#a83c43", "#642d3c"],
};

function seededNoise(index: number, salt: number) {
  const raw = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function parseDemoData(csv: string): PlacePoint[] {
  const lines = csv.trim().split(/\r?\n/);
  const raw = lines.slice(1).map((line, index) => {
    const cells = line.split(",");
    return {
      id: Number(cells[0] || index),
      sqft: Number(cells[2]),
      grade: Number(cells[4]),
      x: Number(cells[9]),
      y: Number(cells[10]),
      value: Number(cells[11]),
    };
  }).filter((point) => Object.values(point).every(Number.isFinite));

  const xs = raw.map((point) => point.x);
  const ys = raw.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return raw.map((point, index) => ({
    ...point,
    x: (point.x - minX) / (maxX - minX),
    y: 1 - (point.y - minY) / (maxY - minY),
    uncertainty: 0.08 + seededNoise(index, 3) * 0.38 + Math.abs(0.5 - (point.x - minX) / (maxX - minX)) * 0.16,
    error: 0.03 + seededNoise(index, 7) * 0.46,
  }));
}

function fallbackPoints(): PlacePoint[] {
  return Array.from({ length: 340 }, (_, index) => {
    const x = seededNoise(index, 2);
    const y = seededNoise(index, 5);
    return {
      id: index,
      x,
      y,
      value: 4.9 + x * 0.8 + (1 - y) * 0.7 + seededNoise(index, 9) * 0.3,
      uncertainty: 0.08 + seededNoise(index, 3) * 0.42,
      error: 0.03 + seededNoise(index, 7) * 0.46,
      sqft: 700 + Math.round(seededNoise(index, 4) * 2800),
      grade: 5 + Math.round(seededNoise(index, 6) * 6),
    };
  });
}

function SpatialMap({ layer, points, selected, onSelect }: {
  layer: Layer;
  points: PlacePoint[];
  selected: PlacePoint | null;
  onSelect: (point: PlacePoint) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boundsRef = useRef({ width: 1, height: 1, pad: 34 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = rect.width;
      const height = rect.height;
      const pad = Math.min(38, width * 0.06);
      boundsRef.current = { width, height, pad };

      context.fillStyle = "#e8ebe4";
      context.fillRect(0, 0, width, height);

      context.strokeStyle = "rgba(56, 74, 64, 0.11)";
      context.lineWidth = 1;
      for (let i = -2; i < 12; i += 1) {
        context.beginPath();
        context.moveTo(i * width * 0.12, 0);
        context.lineTo(i * width * 0.12 + width * 0.36, height);
        context.stroke();
      }
      for (let i = 1; i < 9; i += 1) {
        context.beginPath();
        context.moveTo(0, i * height * 0.12 + Math.sin(i) * 24);
        context.bezierCurveTo(width * 0.32, i * height * 0.1, width * 0.67, i * height * 0.15, width, i * height * 0.11);
        context.stroke();
      }

      context.fillStyle = "rgba(119, 172, 181, 0.24)";
      context.beginPath();
      context.moveTo(width * 0.78, 0);
      context.bezierCurveTo(width * 0.72, height * 0.25, width * 0.88, height * 0.44, width * 0.8, height * 0.67);
      context.bezierCurveTo(width * 0.76, height * 0.82, width * 0.92, height * 0.9, width * 0.9, height);
      context.lineTo(width, height);
      context.lineTo(width, 0);
      context.closePath();
      context.fill();

      const values = points.map((point) => point[layer === "prediction" ? "value" : layer]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const colors = palettes[layer];

      points.forEach((point) => {
        const value = point[layer === "prediction" ? "value" : layer];
        const normalized = (value - min) / (max - min || 1);
        const color = colors[Math.min(colors.length - 1, Math.floor(normalized * colors.length))];
        const px = pad + point.x * (width - pad * 2);
        const py = pad + point.y * (height - pad * 2);
        context.beginPath();
        context.arc(px, py, width < 600 ? 2.2 : 3.1, 0, Math.PI * 2);
        context.fillStyle = color;
        context.globalAlpha = 0.82;
        context.fill();
      });
      context.globalAlpha = 1;

      if (selected) {
        const px = pad + selected.x * (width - pad * 2);
        const py = pad + selected.y * (height - pad * 2);
        context.beginPath();
        context.arc(px, py, 8, 0, Math.PI * 2);
        context.strokeStyle = "#111b17";
        context.lineWidth = 2;
        context.stroke();
        context.beginPath();
        context.arc(px, py, 12, 0, Math.PI * 2);
        context.strokeStyle = "rgba(255,255,255,.92)";
        context.lineWidth = 3;
        context.stroke();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [layer, points, selected]);

  const chooseNearest = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const { width, height, pad } = boundsRef.current;
    const x = (event.clientX - rect.left - pad) / (width - pad * 2);
    const y = (event.clientY - rect.top - pad) / (height - pad * 2);
    let nearest = points[0];
    let distance = Infinity;
    points.forEach((point) => {
      const next = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (next < distance) {
        nearest = point;
        distance = next;
      }
    });
    if (nearest) onSelect(nearest);
  };

  return (
    <canvas
      ref={canvasRef}
      className="spatial-canvas"
      onPointerDown={chooseNearest}
      aria-label={`Interactive ${layerMeta[layer].label.toLowerCase()} map of the Seattle housing demo dataset`}
    />
  );
}

function LogoMark() {
  return <span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>;
}

export function GeoPredictApp() {
  const [route, setRoute] = useState<Route>("fast");
  const [layer, setLayer] = useState<Layer>("prediction");
  const [points, setPoints] = useState<PlacePoint[]>(fallbackPoints);
  const [selected, setSelected] = useState<PlacePoint | null>(null);
  const engine = route === "fast" ? "TabPFN-GSA" : "GeoAggregator";

  useEffect(() => {
    fetch("/data/seattle-housing-demo.csv")
      .then((response) => response.text())
      .then((csv) => setPoints(parseDemoData(csv)))
      .catch(() => undefined);
  }, []);

  const pointSummary = useMemo(() => {
    if (!selected) return null;
    return {
      value: selected.value.toFixed(2),
      uncertainty: selected.uncertainty.toFixed(2),
      error: selected.error.toFixed(2),
      sqft: Math.round(selected.sqft).toLocaleString(),
    };
  }, [selected]);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="GeoPredict home"><LogoMark /><span>GeoPredict</span></a>
        <nav aria-label="Primary navigation">
          <button onClick={() => scrollTo("workflow")}>How it works</button>
          <button onClick={() => scrollTo("evidence")}>Evidence</button>
          <a href="https://github.com/ruid7181/TabPFN-GSA" target="_blank" rel="noreferrer">Open source</a>
        </nav>
        <button className="header-cta" onClick={() => scrollTo("about")}>Project brief</button>
      </header>

      <section className="product-hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> Spatial prediction workspace</p>
          <h1>AI that knows<br />where it is.</h1>
          <p className="hero-intro">GeoPredict turns geospatial tables into reliable, place-aware predictions by joining spatial diagnosis, model routing and uncertainty mapping in one workflow.</p>
        </div>

        <div className="workspace" aria-label="Interactive GeoPredict product demonstration">
          <aside className="workspace-controls">
            <div className="control-heading">
              <span className="status-dot" />
              <div><small>Dataset ready</small><strong>Seattle housing</strong></div>
            </div>

            <div className="data-summary">
              <div><span>Rows</span><strong>{points.length.toLocaleString()}</strong></div>
              <div><span>Features</span><strong>8</strong></div>
              <div><span>Target</span><strong>Price</strong></div>
            </div>

            <fieldset>
              <legend>Modelling route</legend>
              <div className="route-switch">
                <button className={route === "fast" ? "active" : ""} onClick={() => setRoute("fast")} aria-pressed={route === "fast"}>
                  <span>Fast start</span><small>Small data, rapid inference</small>
                </button>
                <button className={route === "custom" ? "active" : ""} onClick={() => setRoute("custom")} aria-pressed={route === "custom"}>
                  <span>Custom training</span><small>Larger, tailored models</small>
                </button>
              </div>
            </fieldset>

            <div className="route-result">
              <span>Selected engine</span><strong>{engine}</strong>
              <p>{route === "fast" ? "Localised context with repeated spatial sampling." : "Trainable local attention with global place awareness."}</p>
            </div>

            <div className="run-status">
              <div><span>1</span><p>Spatial checks</p><b>Passed</b></div>
              <div><span>2</span><p>Spatial cross-validation</p><b>Ready</b></div>
              <div><span>3</span><p>Responsible outputs</p><b>Mapped</b></div>
            </div>
          </aside>

          <div className="map-stage">
            <div className="map-toolbar">
              <div className="layer-tabs" role="tablist" aria-label="Map layer">
                {(Object.keys(layerMeta) as Layer[]).map((item) => (
                  <button key={item} className={layer === item ? "active" : ""} onClick={() => setLayer(item)} role="tab" aria-selected={layer === item}>{layerMeta[item].label}</button>
                ))}
              </div>
              <span className="demo-badge">Interactive demo</span>
            </div>

            <div className="map-canvas-wrap">
              <SpatialMap layer={layer} points={points} selected={selected} onSelect={setSelected} />
              <div className="map-title"><span>{layerMeta[layer].label}</span><strong>Seattle, WA</strong></div>
              <div className="north-arrow" aria-hidden="true"><span>N</span><i /></div>
              <div className="map-legend"><span>{layerMeta[layer].low}</span><i className={`legend-ramp ${layer}`} /><span>{layerMeta[layer].high}</span></div>
              <div className={`point-inspector ${selected ? "visible" : ""}`}>
                {pointSummary ? (
                  <>
                    <button onClick={() => setSelected(null)} aria-label="Close location details">x</button>
                    <small>Location {selected?.id}</small>
                    <strong>{pointSummary.sqft} sq ft / grade {selected?.grade}</strong>
                    <div><span>Prediction</span><b>{pointSummary.value}</b></div>
                    <div><span>Uncertainty</span><b>{pointSummary.uncertainty}</b></div>
                    <div><span>CV error</span><b>{pointSummary.error}</b></div>
                  </>
                ) : <p>Select a point to inspect its local result.</p>}
              </div>
            </div>
            <footer className="map-footer"><span>Source: GA-sklearn Seattle housing sample</span><span>Prototype outputs are illustrative</span></footer>
          </div>
        </div>
      </section>

      <section className="problem-band">
        <p className="section-number">01 / THE PROBLEM</p>
        <div><h2>Rows live somewhere.</h2><p>Most machine learning treats observations as independent. Places are not. Nearby locations influence one another, relationships change across regions, and random data splits can make a weak model look reliable.</p></div>
        <div className="failure-list"><span>Spatial leakage <b>01</b></span><span>Hidden local failure <b>02</b></span><span>False confidence <b>03</b></span></div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-heading">
          <p className="section-number">02 / ONE WORKFLOW</p>
          <h2>From a spatial table to a decision-ready map.</h2>
          <p>One product governs the whole journey. The model is a component inside the workflow, not the workflow itself.</p>
        </div>
        <div className="workflow-track">
          {[["01", "Prepare", "Coordinates, target and features"], ["02", "Diagnose", "Dependence and heterogeneity"], ["03", "Route", "Choose the right spatial engine"], ["04", "Predict", "Fit with place-aware context"], ["05", "Validate", "Test across geographic folds"], ["06", "Map", "Prediction, error and uncertainty"]].map(([number, title, text]) => (
            <article key={number}><span>{number}</span><i /><h3>{title}</h3><p>{text}</p></article>
          ))}
        </div>
      </section>

      <section className="engines-section">
        <div className="section-heading light"><p className="section-number">03 / TWO ROUTES</p><h2>The right amount of model for the task.</h2></div>
        <div className="engine-grid">
          <article className="engine-card fast-engine">
            <div className="engine-top"><span>Fast start</span><b>01</b></div><h3>TabPFN-GSA</h3>
            <p>A pretrained tabular foundation model adapted to geography by concentrating context on nearby observations and sampling a smaller share of distant ones.</p>
            <dl><div><dt>Best fit</dt><dd>Small data, rapid modelling</dd></div><div><dt>Spatial idea</dt><dd>Geospatial sparse attention</dd></div><div><dt>Uncertainty</dt><dd>Repeated local sampling</dd></div></dl>
            <a href="https://github.com/ruid7181/TabPFN-GSA" target="_blank" rel="noreferrer">View repository <span>↗</span></a>
          </article>
          <article className="engine-card custom-engine">
            <div className="engine-top"><span>Custom training</span><b>02</b></div><h3>GeoAggregator</h3>
            <p>A lightweight trainable transformer that learns spatial autocorrelation through local attention and geographic heterogeneity through global positional awareness.</p>
            <dl><div><dt>Best fit</dt><dd>Larger, task-specific data</dd></div><div><dt>Spatial idea</dt><dd>Local and global place context</dd></div><div><dt>Interface</dt><dd>Scikit-learn compatible</dd></div></dl>
            <a href="https://github.com/ruid7181/GA-sklearn" target="_blank" rel="noreferrer">View repository <span>↗</span></a>
          </article>
        </div>
      </section>

      <section className="evidence-section" id="evidence">
        <div className="section-heading"><p className="section-number">04 / RESEARCH TO PRODUCT</p><h2>Built on published methods.<br />Designed for use.</h2></div>
        <div className="evidence-grid">
          <article className="paper-card">
            <div className="paper-image"><img src="/research/geoaggregator-architecture.png" alt="GeoAggregator research architecture diagram" /></div>
            <span>AAAI 2025</span><h3>GeoAggregator</h3><p>An Efficient Transformer Model for Geo-Spatial Tabular Data</p>
            <a href="https://ojs.aaai.org/index.php/AAAI/article/view/33243" target="_blank" rel="noreferrer">Read publication</a>
          </article>
          <article className="paper-card">
            <div className="paper-image"><img src="/research/gsa-attention.png" alt="Geospatial sparse attention method diagram" /></div>
            <span>IJGIS 2026</span><h3>TabPFN-GSA</h3><p>Do foundation models work for geospatial tabular data?</p>
            <a href="https://doi.org/10.1080/13658816.2026.2691066" target="_blank" rel="noreferrer">Read publication</a>
          </article>
          <aside className="evidence-note"><p>What GeoPredict adds</p><h3>Research becomes a repeatable decision process.</h3><ul><li><span>01</span>Shared spatial diagnostics</li><li><span>02</span>Model routing by task</li><li><span>03</span>Geographic validation</li><li><span>04</span>Transparent uncertainty</li><li><span>05</span>Exportable evidence maps</li></ul></aside>
        </div>
      </section>

      <section className="impact-section">
        <div className="impact-copy"><p className="section-number">05 / PUBLIC VALUE</p><h2>Know where a model works before a decision depends on it.</h2></div>
        <div className="impact-uses">
          {[["Cities", "Target housing, transport and neighbourhood investment."], ["Environment", "Map air quality, heat and ecological risk."], ["Public health", "Identify uneven exposure and local model failure."], ["Infrastructure", "Plan assets with geographically honest forecasts."]].map(([title, text], index) => (
            <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{text}</p></article>
          ))}
        </div>
      </section>

      <section className="about-section" id="about">
        <div><p className="section-number">PROJECT TEAM</p><h2>Open tools for geographically responsible AI.</h2></div>
        <div className="team-list"><div><strong>Rui Deng</strong><span>Technical lead</span></div><div><strong>Mingshu Wang</strong><span>Research and impact</span></div><div><strong>Ziqi Li</strong><span>Methods collaborator</span></div></div>
        <div className="application-note"><span>Prototypes for Humanity 2026</span><p>GeoPredict is being developed as an open toolkit and demonstrator for spatially reliable AI.</p><a href="https://www.prototypesforhumanity.com/latestnews/stories/how-to-apply" target="_blank" rel="noreferrer">View programme <span>↗</span></a></div>
      </section>

      <footer className="site-footer"><a className="brand footer-brand" href="#top"><LogoMark /><span>GeoPredict</span></a><p>Place-aware AI for spatial prediction.</p><div><a href="https://github.com/ruid7181/TabPFN-GSA" target="_blank" rel="noreferrer">TabPFN-GSA</a><a href="https://github.com/ruid7181/GA-sklearn" target="_blank" rel="noreferrer">GeoAggregator</a></div></footer>
    </main>
  );
}
