/**
 * Static imports of the JSON exemplar files. esbuild bundles these directly
 * so they ship inside dist/index.mjs without needing a separate copy step in
 * build.mjs.
 *
 * To add a new exemplar:
 *   1. Drop the parsed .json next to this file (run scripts/build_boq_exemplars.py).
 *   2. Add an import line below and push it into the EXEMPLARS array.
 */
import camp from "./1158-camp-moreell-lift-station.json" with { type: "json" };
import mwd from "./1159-mwd-obedience-area.json" with { type: "json" };
import warehouse from "./1162-cargo-warehouse.json" with { type: "json" };
import type { BoqExemplar } from "./index";

export const EXEMPLARS: BoqExemplar[] = [
  camp as unknown as BoqExemplar,
  mwd as unknown as BoqExemplar,
  warehouse as unknown as BoqExemplar,
];
