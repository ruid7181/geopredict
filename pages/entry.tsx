import { createRoot } from "react-dom/client";
import { GeoPredictApp } from "../app/geopredict-app";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing GeoPredict root element");

createRoot(root).render(<GeoPredictApp />);
