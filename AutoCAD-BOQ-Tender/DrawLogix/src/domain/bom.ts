import type { Takeoff } from "./takeoff";

/** A priced line item derived from a takeoff quantity × a unit rate. */
export interface BomItem {
  key: string;
  label: string;
  qty: number;
  unit: string;
  rate: number;
  cost: number;
}

export interface RateRow {
  key: string;
  label: string;
  unit: string;
  rate: number;
}

/** Default unit rates (editable in the UI). Currency-agnostic. */
export const DEFAULT_RATES: RateRow[] = [
  { key: "floor", label: "Floor finish", unit: "m²", rate: 45 },
  { key: "exterior", label: "Exterior wall", unit: "m", rate: 180 },
  { key: "partition", label: "Internal partition", unit: "m", rate: 90 },
  { key: "door", label: "Door (supply + install)", unit: "ea", rate: 450 },
  { key: "window", label: "Window", unit: "ea", rate: 600 },
  { key: "equipment", label: "Equipment / fittings", unit: "ea", rate: 250 },
  // Electrical / MEP (priced when the drawing carries an E-* layer set).
  { key: "light", label: "Light fitting", unit: "ea", rate: 75 },
  { key: "socket", label: "Socket outlet", unit: "ea", rate: 45 },
  { key: "switch", label: "Light switch", unit: "ea", rate: 35 },
  { key: "board", label: "Distribution board", unit: "ea", rate: 900 },
  { key: "mepcable", label: "Cable / conduit", unit: "m", rate: 12 },
];

const qtyFor = (key: string, t: Takeoff): number => {
  switch (key) {
    case "floor":
      return t.floorAreaSqm;
    case "exterior":
      return t.exteriorWallM;
    case "partition":
      return t.partitionWallM;
    case "door":
      return t.doors;
    case "window":
      return t.windows;
    case "equipment":
      return t.equipment;
    case "light":
      return t.lights;
    case "socket":
      return t.sockets;
    case "switch":
      return t.switches;
    case "board":
      return t.boards;
    case "mepcable":
      return t.mepCableM;
    default:
      return 0;
  }
};

export function buildBom(t: Takeoff, rates: RateRow[]): { items: BomItem[]; total: number } {
  const items = rates.map((r) => {
    const qty = qtyFor(r.key, t);
    return { key: r.key, label: r.label, qty, unit: r.unit, rate: r.rate, cost: Math.round(qty * r.rate) };
  });
  const total = items.reduce((a, i) => a + i.cost, 0);
  return { items, total };
}

/** BOM → CSV string for download. */
export function bomToCsv(items: BomItem[], total: number): string {
  const rows = [["Item", "Quantity", "Unit", "Rate", "Cost"], ...items.map((i) => [i.label, String(i.qty), i.unit, String(i.rate), String(i.cost)]), ["Total", "", "", "", String(total)]];
  return rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}
