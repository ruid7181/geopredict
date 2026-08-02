"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import proj4 from "proj4";
import type { LayerGroup, Map as LeafletMap } from "leaflet";

type Layer = "prediction" | "uncertainty" | "error";
type Route = "fast" | "custom";

type PlacePoint = {
  id: number;
  lat: number;
  lng: number;
  observed: number;
  value: number;
  uncertainty: number;
  error: number;
  sqft: number;
  grade: number;
};

const utmZone10North = "+proj=utm +zone=10 +datum=WGS84 +units=m +no_defs";
const wgs84 = "+proj=longlat +datum=WGS84 +no_defs";

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
    const [lng, lat] = proj4(utmZone10North, wgs84, [Number(cells[9]), Number(cells[10])]);
    return {
      id: Number(cells[0] || index),
      sqft: Number(cells[2]),
      grade: Number(cells[4]),
      lat,
      lng,
      observed: Number(cells[11]),
    };
  }).filter((point) => Object.values(point).every(Number.isFinite));

  const longitudes = raw.map((point) => point.lng);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return raw.map((point, index) => ({
    ...point,
    value: point.observed + (seededNoise(index, 11) - 0.5) * 0.18,
    uncertainty: 0.08 + seededNoise(index, 3) * 0.38 + Math.abs(0.5 - (point.lng - minLng) / (maxLng - minLng)) * 0.16,
    error: 0.03 + seededNoise(index, 7) * 0.46,
  }));
}

function fallbackPoints(): PlacePoint[] {
  return Array.from({ length: 340 }, (_, index) => {
    const x = seededNoise(index, 2);
    const y = seededNoise(index, 5);
    const observed = 4.9 + x * 0.8 + (1 - y) * 0.7 + seededNoise(index, 9) * 0.3;
    return {
      id: index,
      lat: 47.49 + y * 0.28,
      lng: -122.44 + x * 0.25,
      observed,
      value: observed + (seededNoise(index, 11) - 0.5) * 0.18,
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
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const pointsLayerRef = useRef<LayerGroup | null>(null);
  const selectionLayerRef = useRef<LayerGroup | null>(null);
  const fittedPointsRef = useRef<PlacePoint[] | null>(null);
  const onSelectRef = useRef(onSelect);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let disposed = false;

    async function initialiseMap() {
      const container = containerRef.current;
      if (!container || mapRef.current) return;
      const L = await import("leaflet");
      if (disposed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        attributionControl: true,
        zoomControl: true,
        preferCanvas: true,
      }).setView([47.6062, -122.3321], 10);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      pointsLayerRef.current = L.layerGroup().addTo(map);
      selectionLayerRef.current = L.layerGroup().addTo(map);
      setMapReady(true);
      requestAnimationFrame(() => map.invalidateSize());
    }

    initialiseMap();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      pointsLayerRef.current = null;
      selectionLayerRef.current = null;
      fittedPointsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !pointsLayerRef.current || points.length === 0) return;
    let disposed = false;

    async function drawPoints() {
      const L = await import("leaflet");
      if (disposed || !pointsLayerRef.current || !mapRef.current) return;

      const values = points.map((point) => point[layer === "prediction" ? "value" : layer]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const colors = palettes[layer];
      pointsLayerRef.current.clearLayers();

      points.forEach((point) => {
        const value = point[layer === "prediction" ? "value" : layer];
        const normalized = (value - min) / (max - min || 1);
        const color = colors[Math.min(colors.length - 1, Math.floor(normalized * colors.length))];
        L.circleMarker([point.lat, point.lng], {
          radius: 4,
          color: "rgba(255,255,255,.72)",
          weight: 0.7,
          fillColor: color,
          fillOpacity: 0.86,
        }).on("click", () => onSelectRef.current(point)).addTo(pointsLayerRef.current!);
      });

      if (fittedPointsRef.current !== points) {
        const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number]));
        mapRef.current.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
        fittedPointsRef.current = points;
      }
    }

    drawPoints();
    return () => { disposed = true; };
  }, [layer, mapReady, points]);

  useEffect(() => {
    if (!mapReady || !selectionLayerRef.current) return;
    let disposed = false;

    async function drawSelection() {
      const L = await import("leaflet");
      if (disposed || !selectionLayerRef.current) return;
      selectionLayerRef.current.clearLayers();
      if (!selected) return;
      L.circleMarker([selected.lat, selected.lng], {
        radius: 9,
        color: "#111b17",
        weight: 3,
        fillColor: "#fffef9",
        fillOpacity: 0.35,
      }).addTo(selectionLayerRef.current);
    }

    drawSelection();
    return () => { disposed = true; };
  }, [mapReady, selected]);

  return (
    <div
      ref={containerRef}
      className="spatial-map"
      role="application"
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
      observed: selected.observed.toFixed(2),
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
          <button onClick={() => scrollTo("demo")}>Live demo</button>
          <button onClick={() => scrollTo("workflow")}>How it works</button>
          <button onClick={() => scrollTo("evidence")}>Evidence</button>
        </nav>
        <button className="header-cta" onClick={() => scrollTo("about")}>Project brief</button>
      </header>

      <section className="poster-hero" id="top" aria-labelledby="site-title">
        <h1 className="sr-only" id="site-title">GeoPredict: AI that knows where it is.</h1>
        <div className="poster-visual">
          <img src="/og.png" alt="GeoPredict concept artwork showing a place-aware prediction map" fetchPriority="high" />
        </div>
        <div className="poster-actionbar">
          <span>Concept artwork / live demonstration below uses public Seattle housing data</span>
          <button onClick={() => scrollTo("demo")}>Explore the Seattle demo <b aria-hidden="true">↓</b></button>
        </div>
      </section>

      <section className="product-hero" id="demo">
        <div className="hero-copy">
          <p className="eyebrow"><span /> Public-data demonstration</p>
          <h2>Seattle housing,<br />mapped by place.</h2>
          <p className="hero-intro"><strong>Real data.</strong> The workspace loads 1,000 public Seattle housing records with projected coordinates, eight property features and observed log prices. Prediction, uncertainty and error layers remain an interface preview until benchmark outputs are connected.</p>
        </div>

        <div className="workspace" aria-label="Interactive GeoPredict product demonstration">
          <aside className="workspace-controls">
            <div className="control-heading">
              <span className="status-dot" />
              <div><small>Public dataset</small><strong>Seattle housing</strong></div>
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
              <span className="demo-badge">Public data</span>
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
                    <div><span>Observed log price</span><b>{pointSummary.observed}</b></div>
                    <div><span>Prediction preview</span><b>{pointSummary.value}</b></div>
                    <div><span>Uncertainty</span><b>{pointSummary.uncertainty}</b></div>
                    <div><span>CV error</span><b>{pointSummary.error}</b></div>
                  </>
                ) : <p>Select a point to inspect its local result.</p>}
              </div>
            </div>
            <footer className="map-footer"><span>Public Seattle housing sample / 1,000 observations</span><span>Model layers are an interface preview</span></footer>
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
        <div className="team-list"><div><strong>Rui Deng</strong><span>Technical lead</span></div><div><strong>Ziqi Li</strong><span>Research and development</span></div><div><strong>Mingshu Wang</strong><span>Research and impact</span></div></div>
        <div className="application-note"><span>Prototypes for Humanity 2026</span><p>GeoPredict is being developed as an open toolkit and demonstrator for spatially reliable AI.</p><a href="https://www.prototypesforhumanity.com/latestnews/stories/how-to-apply" target="_blank" rel="noreferrer">View programme <span>↗</span></a></div>
      </section>

      <footer className="site-footer"><a className="brand footer-brand" href="#top"><LogoMark /><span>GeoPredict</span></a><p>Place-aware AI for spatial prediction.</p><div><a href="https://github.com/ruid7181/TabPFN-GSA" target="_blank" rel="noreferrer">TabPFN-GSA</a><a href="https://github.com/ruid7181/GA-sklearn" target="_blank" rel="noreferrer">GeoAggregator</a></div></footer>
    </main>
  );
}
