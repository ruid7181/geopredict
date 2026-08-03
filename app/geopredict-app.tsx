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
  gaValue: number;
  gaUncertainty: number;
  gaError: number;
  sqft: number;
  grade: number;
};

const utmZone10North = "+proj=utm +zone=10 +datum=WGS84 +units=m +no_defs";
const wgs84 = "+proj=longlat +datum=WGS84 +no_defs";
const publicAsset = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;

const engineLabels: Record<Route, string> = {
  fast: "TabPFN-GSA",
  custom: "GeoAggregator",
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

const gsaPublishedResults = [
  { dataset: "PM2.5", tabpfn: 0.811, gsa: 0.811 },
  { dataset: "Election", tabpfn: 0.929, gsa: 0.933 },
  { dataset: "Housing", tabpfn: 0.894, gsa: 0.919 },
  { dataset: "Poverty", tabpfn: null, gsa: 0.847 },
];

const gaHousingResults = [
  { model: "XGBoost", r2: 0.888 },
  { model: "GCNNWR", r2: 0.895 },
  { model: "Vanilla mini", r2: 0.906 },
  { model: "GA-mini", r2: 0.911 },
];

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

  return raw.map((point, index) => {
    const longitudePosition = (point.lng - minLng) / (maxLng - minLng);
    const edgeDistance = Math.abs(0.5 - longitudePosition);
    const localPattern = Math.sin((point.lat - 47.5) * 24 + (point.lng + 122.3) * 18) * 0.025;
    return {
      ...point,
      value: point.observed + (seededNoise(index, 11) - 0.5) * 0.18,
      uncertainty: 0.08 + seededNoise(index, 3) * 0.38 + edgeDistance * 0.16,
      error: 0.03 + seededNoise(index, 7) * 0.46,
      gaValue: point.observed + (seededNoise(index, 13) - 0.5) * 0.13 + localPattern,
      gaUncertainty: 0.06 + seededNoise(index, 17) * 0.3 + edgeDistance * 0.1,
      gaError: 0.025 + seededNoise(index, 19) * 0.34,
    };
  });
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
      gaValue: observed + (seededNoise(index, 13) - 0.5) * 0.13,
      gaUncertainty: 0.06 + seededNoise(index, 17) * 0.34,
      gaError: 0.025 + seededNoise(index, 19) * 0.34,
      sqft: 700 + Math.round(seededNoise(index, 4) * 2800),
      grade: 5 + Math.round(seededNoise(index, 6) * 6),
    };
  });
}

function pointMetric(point: PlacePoint, layer: Layer, route: Route) {
  if (route === "custom") {
    if (layer === "prediction") return point.gaValue;
    if (layer === "uncertainty") return point.gaUncertainty;
    return point.gaError;
  }
  if (layer === "prediction") return point.value;
  if (layer === "uncertainty") return point.uncertainty;
  return point.error;
}

function SpatialMap({ layer, route, points, selected, onSelect }: {
  layer: Layer;
  route: Route;
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

      const values = points.map((point) => pointMetric(point, layer, route));
      const min = Math.min(...values);
      const max = Math.max(...values);
      const colors = palettes[layer];
      pointsLayerRef.current.clearLayers();

      points.forEach((point) => {
        const value = pointMetric(point, layer, route);
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
  }, [layer, mapReady, points, route]);

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
      aria-label={`Interactive ${engineLabels[route]} ${layerMeta[layer].label.toLowerCase()} map of the Seattle housing demo dataset`}
    />
  );
}

function DemoDiagnostics({ points, route }: { points: PlacePoint[]; route: Route }) {
  const diagnostics = useMemo(() => {
    const observed = points.map((point) => point.observed);
    const predicted = points.map((point) => pointMetric(point, "prediction", route));
    const min = Math.min(...observed, ...predicted);
    const max = Math.max(...observed, ...predicted);
    const binCount = 7;
    const observedBins = Array(binCount).fill(0) as number[];
    const predictedBins = Array(binCount).fill(0) as number[];
    const addToBin = (value: number, bins: number[]) => {
      const index = Math.min(binCount - 1, Math.floor(((value - min) / (max - min || 1)) * binCount));
      bins[index] += 1;
    };
    observed.forEach((value) => addToBin(value, observedBins));
    predicted.forEach((value) => addToBin(value, predictedBins));
    const maxBin = Math.max(...observedBins, ...predictedBins, 1);

    const latitudes = points.map((point) => point.lat).sort((a, b) => a - b);
    const longitudes = points.map((point) => point.lng).sort((a, b) => a - b);
    const medianLat = latitudes[Math.floor(latitudes.length / 2)] ?? 47.6062;
    const medianLng = longitudes[Math.floor(longitudes.length / 2)] ?? -122.3321;
    const foldMap = new Map<string, number[]>([["NW", []], ["NE", []], ["SW", []], ["SE", []]]);
    points.forEach((point) => {
      const vertical = point.lat >= medianLat ? "N" : "S";
      const horizontal = point.lng < medianLng ? "W" : "E";
      foldMap.get(`${vertical}${horizontal}`)?.push(pointMetric(point, "error", route));
    });
    const folds = [...foldMap].map(([label, values]) => ({
      label,
      value: values.reduce((sum, value) => sum + value, 0) / (values.length || 1),
    }));
    const maxFold = Math.max(...folds.map((fold) => fold.value), 1);

    const confidence = [
      { label: "More certain", count: 0 },
      { label: "Watch", count: 0 },
      { label: "Review", count: 0 },
    ];
    points.forEach((point) => {
      const value = pointMetric(point, "uncertainty", route);
      confidence[value < 0.2 ? 0 : value < 0.35 ? 1 : 2].count += 1;
    });

    return { observedBins, predictedBins, maxBin, min, max, folds, maxFold, confidence };
  }, [points, route]);

  return (
    <section className="diagnostics-section" aria-labelledby="diagnostics-title">
      <div className="diagnostics-heading">
        <p className="section-number">LIVE OUTPUTS</p>
        <div><h2 id="diagnostics-title">See more than a prediction.</h2><p>Three diagnostics update with the selected engine. They describe the Seattle interface preview; they are not benchmark claims.</p></div>
        <span>{engineLabels[route]} / {points.length.toLocaleString()} locations</span>
      </div>

      <div className="diagnostics-grid">
        <figure className="diagnostic-figure distribution-figure">
          <header><span>01</span><h3>Observed vs preview distribution</h3></header>
          <div className="histogram" aria-label="Observed and preview prediction distributions">
            {diagnostics.observedBins.map((count, index) => (
              <div className="histogram-bin" key={index}>
                <i className="observed-bar" style={{ height: `${Math.max(4, count / diagnostics.maxBin * 100).toFixed(2)}%` }} />
                <i className="predicted-bar" style={{ height: `${Math.max(4, diagnostics.predictedBins[index] / diagnostics.maxBin * 100).toFixed(2)}%` }} />
              </div>
            ))}
          </div>
          <div className="histogram-axis"><span>{diagnostics.min.toFixed(1)}</span><span>Log price</span><span>{diagnostics.max.toFixed(1)}</span></div>
          <figcaption><i className="observed-key" /> Observed <i className="predicted-key" /> {engineLabels[route]} preview</figcaption>
        </figure>

        <figure className="diagnostic-figure">
          <header><span>02</span><h3>Spatial fold error</h3></header>
          <div className="fold-chart">
            {diagnostics.folds.map((fold) => (
              <div className="fold-row" key={fold.label}><span>{fold.label}</span><i><b style={{ width: `${(fold.value / diagnostics.maxFold * 100).toFixed(2)}%` }} /></i><strong>{fold.value.toFixed(2)}</strong></div>
            ))}
          </div>
          <figcaption>Quadrant check / lower is better</figcaption>
        </figure>

        <figure className="diagnostic-figure">
          <header><span>03</span><h3>Confidence profile</h3></header>
          <div className="confidence-chart">
            {diagnostics.confidence.map((band, index) => {
              const percent = Math.round((band.count / Math.max(points.length, 1)) * 100);
              return <div className={`confidence-band confidence-${index + 1}`} key={band.label} style={{ flexGrow: Math.max(percent, 7) }}><strong>{percent}%</strong><span>{band.label}</span></div>;
            })}
          </div>
          <figcaption>Locations grouped by preview uncertainty</figcaption>
        </figure>
      </div>

      <div className="output-steps" aria-label="Result workflow">
        {[['01', 'Choose', 'Match the engine to data scale'], ['02', 'Validate', 'Use geographic folds, not random splits'], ['03', 'Inspect', 'Read errors and uncertainty by place'], ['04', 'Export', 'Package maps with source and limits']].map(([number, title, text]) => (
          <div key={number}><span>{number}</span><strong>{title}</strong><p>{text}</p></div>
        ))}
      </div>
    </section>
  );
}

function PublishedEvidence() {
  const chartWidth = (value: number) => `${Math.max(5, Math.min(100, ((value - 0.75) / 0.2) * 100)).toFixed(2)}%`;
  return (
    <div className="published-evidence">
      <div className="evidence-callout"><span>Published benchmark evidence</span><strong>Accuracy where local context matters. Efficiency when data grows.</strong><p>Values below are reproduced from the two peer-reviewed papers, separate from the Seattle interface preview.</p></div>

      <figure className="benchmark-figure">
        <header><span>TabPFN-GSA / real-world R²</span><b>Higher is better</b></header>
        <div className="benchmark-legend"><i className="base-key" /> TabPFN <i className="gsa-key" /> Best GSA</div>
        <div className="benchmark-groups">
          {gsaPublishedResults.map((result) => (
            <div className="benchmark-group" key={result.dataset}>
              <span>{result.dataset}</span>
              <div>{result.tabpfn === null ? <em>Not completed</em> : <i className="base-bar" style={{ width: chartWidth(result.tabpfn) }}><b>{result.tabpfn.toFixed(3)}</b></i>}</div>
              <div><i className="gsa-bar" style={{ width: chartWidth(result.gsa) }}><b>{result.gsa.toFixed(3)}</b></i></div>
            </div>
          ))}
        </div>
        <figcaption>GSA reaches R² 0.919 on Housing and completes the 71,900-row Poverty dataset where standard TabPFN was not run. <a href="https://doi.org/10.1080/13658816.2026.2691066" target="_blank" rel="noreferrer">IJGIS study ↗</a></figcaption>
      </figure>

      <figure className="benchmark-figure ga-benchmark">
        <header><span>GeoAggregator / Housing R²</span><b>Published result</b></header>
        <div className="ga-bars">
          {gaHousingResults.map((result) => (
            <div key={result.model}><span>{result.model}</span><i><b className={result.model === "GA-mini" ? "highlight" : ""} style={{ width: chartWidth(result.r2) }} /></i><strong>{result.r2.toFixed(3)}</strong></div>
          ))}
        </div>
        <div className="efficiency-strip"><div><strong>4.6K</strong><span>GA-mini parameters</span></div><div><strong>1.6M</strong><span>FLOPs / inference</span></div><div><strong>~1,900×</strong><span>fewer parameters than GCNNWR</span></div></div>
        <figcaption>GA-mini records the strongest Housing R² in the reported comparison while remaining lightweight. <a href="https://ojs.aaai.org/index.php/AAAI/article/view/33259" target="_blank" rel="noreferrer">AAAI-25 paper ↗</a></figcaption>
      </figure>
    </div>
  );
}

function WorkflowFilm() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) video.pause();
    else void video.play().catch(() => undefined);
  }, []);

  return (
    <section className="workflow-film" id="workflow" aria-labelledby="workflow-film-title">
      <div className="workflow-film-heading">
        <p className="section-number">01 / THE WORKFLOW</p>
        <h2 id="workflow-film-title">GeoPredict in 18 seconds.</h2>
        <p>Watch one spatial table move through diagnosis, model routing and geographic validation into prediction, error and uncertainty maps.</p>
      </div>
      <div className="workflow-film-media">
        <video ref={videoRef} autoPlay muted loop playsInline controls preload="metadata" poster={publicAsset("/video/workflow-explainer-poster.png")} aria-describedby="workflow-film-caption">
          <source src={publicAsset("/video/workflow-explainer.mp4")} type="video/mp4" />
          Your browser does not support embedded video.
        </video>
        <div className="workflow-film-caption" id="workflow-film-caption"><span>GeoPredict workflow film</span><span>18 seconds / no audio</span></div>
      </div>
    </section>
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
  const engine = engineLabels[route];

  useEffect(() => {
    fetch(publicAsset("/data/seattle-housing-demo.csv"))
      .then((response) => response.text())
      .then((csv) => setPoints(parseDemoData(csv)))
      .catch(() => undefined);
  }, []);

  const pointSummary = useMemo(() => {
    if (!selected) return null;
    return {
      observed: selected.observed.toFixed(2),
      value: pointMetric(selected, "prediction", route).toFixed(2),
      uncertainty: pointMetric(selected, "uncertainty", route).toFixed(2),
      error: pointMetric(selected, "error", route).toFixed(2),
      sqft: Math.round(selected.sqft).toLocaleString(),
    };
  }, [route, selected]);

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
          <img src={publicAsset("/og.png")} alt="GeoPredict concept artwork showing a place-aware prediction map" fetchPriority="high" />
        </div>
        <div className="poster-actionbar">
          <span>Concept artwork / workflow film and live Seattle demonstration below</span>
          <button onClick={() => scrollTo("workflow")}>Watch the workflow <b aria-hidden="true">↓</b></button>
        </div>
      </section>

      <WorkflowFilm />

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
                  <span>TabPFN-GSA</span><small>Fast start / small data</small>
                </button>
                <button className={route === "custom" ? "active" : ""} onClick={() => setRoute("custom")} aria-pressed={route === "custom"}>
                  <span>GeoAggregator</span><small>Custom training / larger data</small>
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
              <SpatialMap layer={layer} route={route} points={points} selected={selected} onSelect={setSelected} />
              <div className="map-title"><span>{engine} / {layerMeta[layer].label}</span><strong>Seattle, WA</strong></div>
              <div className="north-arrow" aria-hidden="true"><span>N</span><i /></div>
              <div className="map-legend"><span>{layerMeta[layer].low}</span><i className={`legend-ramp ${layer}`} /><span>{layerMeta[layer].high}</span></div>
              <div className={`point-inspector ${selected ? "visible" : ""}`}>
                {pointSummary ? (
                  <>
                    <button onClick={() => setSelected(null)} aria-label="Close location details">x</button>
                    <small>{engine} preview / location {selected?.id}</small>
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

      <DemoDiagnostics points={points} route={route} />

      <section className="problem-band">
        <p className="section-number">02 / THE PROBLEM</p>
        <div><h2>Rows live somewhere.</h2><p>Most machine learning treats observations as independent. Places are not. Nearby locations influence one another, relationships change across regions, and random data splits can make a weak model look reliable.</p></div>
        <div className="failure-list"><span>Spatial leakage <b>01</b></span><span>Hidden local failure <b>02</b></span><span>False confidence <b>03</b></span></div>
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
        <PublishedEvidence />
        <div className="evidence-grid">
          <article className="paper-card">
            <div className="paper-image"><img src={publicAsset("/research/geoaggregator-architecture.png")} alt="GeoAggregator research architecture diagram" /></div>
            <span>AAAI 2025</span><h3>GeoAggregator</h3><p>An Efficient Transformer Model for Geo-Spatial Tabular Data</p>
            <a href="https://ojs.aaai.org/index.php/AAAI/article/view/33259" target="_blank" rel="noreferrer">Read publication</a>
          </article>
          <article className="paper-card">
            <div className="paper-image"><img src={publicAsset("/research/gsa-attention.png")} alt="Geospatial sparse attention method diagram" /></div>
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
        <div className="team-list">
          <div><strong>Rui Deng</strong><span>Technical lead · University of Glasgow</span><span className="team-email">Rui.Deng [at] glasgow.ac.uk</span></div>
          <div><strong>Ziqi Li</strong><span>Research lead · Florida State University</span><span className="team-email">Ziqi.Li [at] fsu.edu</span></div>
          <div><strong>Mingshu Wang</strong><span>Research lead · University of Glasgow</span><span className="team-email">Mingshu.Wang [at] glasgow.ac.uk</span></div>
        </div>
      </section>

      <footer className="site-footer"><a className="brand footer-brand" href="#top"><LogoMark /><span>GeoPredict</span></a><p>Place-aware AI for spatial prediction.</p><div><a href="https://github.com/ruid7181/TabPFN-GSA" target="_blank" rel="noreferrer">TabPFN-GSA</a><a href="https://github.com/ruid7181/GA-sklearn" target="_blank" rel="noreferrer">GeoAggregator</a></div></footer>
    </main>
  );
}
