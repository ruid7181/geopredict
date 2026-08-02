# GeoPredict

GeoPredict is a product demonstrator for place-aware spatial prediction. It unifies two open-source research engines behind one workflow:

- **TabPFN-GSA** for rapid inference on smaller geospatial tabular datasets.
- **GeoAggregator** for larger or more customised trainable spatial models.

The generated GeoPredict map artwork is used as the full-width opening visual. The interactive demo beneath it loads 1,000 public Seattle housing records and shows the shared output contract: prediction, uncertainty and spatial validation error maps.

The locations, housing attributes and observed log prices are real dataset values. Predicted values, uncertainty and error are explicitly labelled as interface previews until exported benchmark results are connected.

The site also includes three engine-responsive Seattle diagnostics (distribution, spatial-fold error and confidence profile) plus published benchmark figures reproduced from the peer-reviewed GeoAggregator and TabPFN-GSA studies. Published evidence and interface-preview values are labelled separately.

## Local development

Requirements: Node.js 22.13 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/`.

## Validation

```bash
pnpm build
node --test tests/rendered-html.test.mjs
```

## Sources

- [TabPFN-GSA](https://github.com/ruid7181/TabPFN-GSA)
- [GA-sklearn / GeoAggregator](https://github.com/ruid7181/GA-sklearn)

The Seattle housing sample and research diagrams in `public/` are copied from GA-sklearn and TabPFN-GSA for this demonstrator. Both source repositories are MIT licensed.
