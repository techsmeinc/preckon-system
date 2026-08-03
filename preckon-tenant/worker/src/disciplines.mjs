/**
 * disciplines — each trade's own standard unit set.
 *
 * Ported from AutoCAD-BOQ-Tender/artifacts/api-server/src/lib/discipline-checklist.ts.
 *
 * WHY PER-DISCIPLINE RATHER THAN ONE FLAT LIST. Every discipline measures
 * differently, and a single global unit list makes the model pick whichever
 * token it saw most in training. Ductwork is bought by weight (kg), not by the
 * metre; a chiller is EA or Set, never m²; roof sheeting is priced by the ton
 * while the membrane over it is m². Given one flat list an agent will happily
 * write "ductwork — 240 m", which prices out at roughly nothing like the real
 * cost and reads as perfectly ordinary on the bill.
 *
 * normalizeUnit() in knowledge.mjs still standardises how a token is SPELLED.
 * This steers which token is CHOSEN.
 */

export const DISCIPLINE_UNITS = [
  {
    label: "Lighting",
    units: [
      ["EA", "luminaires, fittings, exit/emergency units, sensors, dimmers, controllers"],
      ["m", "lighting track, festoon/exterior lighting cable runs"],
      ["LS", "lighting controls commissioning, scene programming, general wiring"],
    ],
  },
  {
    label: "Electrical Power",
    units: [
      ["m", "power/control cabling, conduit, cable tray, trunking, busbar trunking, containment"],
      ["EA", "MDB/SDB/FDB, panels, breakers, isolators, sockets, switches, wiring points"],
      ["Set", "gensets, transformers, UPS, capacitor banks supplied as one assembly"],
      ["LS", "general/small-power wiring, earthing & bonding system, testing & commissioning"],
    ],
  },
  {
    label: "HVAC",
    units: [
      ["EA", "chillers, AHUs, FCUs, VRF units, exhaust fans, diffusers, grilles, dampers, thermostats"],
      ["Set", "packaged/split AC systems & plant supplied as one set"],
      ["kg", "GI/sheet-metal ductwork by weight"],
      ["m²", "duct & refrigerant-pipe thermal insulation"],
      ["m", "refrigerant piping, condensate drainage runs"],
      ["LS", "TAB (testing, adjusting & balancing), controls integration, commissioning"],
    ],
  },
  {
    label: "Plumbing, Drainage & Fire",
    units: [
      ["m", "cold/hot water supply, soil/waste/vent, drainage piping, sprinkler/hydrant mains"],
      ["EA", "sanitary fixtures, valves, tanks, water heaters, floor drains, hydrants, hose reels"],
      ["Set", "booster/transfer/sewage pumps & pump sets"],
      ["m²", "wet-area waterproofing / tanking"],
      ["LS", "pressure testing, disinfection, fire-system commissioning"],
    ],
  },
  {
    label: "Doors, Windows & Façade",
    units: [
      ["EA", "doors, windows, shutters, louvres, ironmongery sets, skylights as units"],
      ["m²", "curtain walling, structural glazing, shopfront/glazed screen area"],
      ["m", "door/window framing, sub-frames, trims by length"],
    ],
  },
  {
    label: "Roofing & Waterproofing",
    units: [
      ["ton", "metal/steel roof sheeting, sandwich panels, purlins/rafters & roof structure by weight"],
      ["m²", "waterproof/roof membrane, thermal insulation, vapour barrier by area"],
      ["m", "flashing, ridge, edge trim, fascia/soffit by length"],
      ["EA", "skylights, roof vents/hatches, roof accessories"],
    ],
  },
  {
    label: "Architectural Finishes",
    units: [
      ["m²", "floor/wall/ceiling finishes, tiling, plaster/render, painting, partitions, cladding, screed"],
      ["m", "skirting, cornices, beading, trims by length"],
      ["EA", "raised-floor pedestals as counted, finish accessories/fittings"],
      ["LS", "sample boards, mock-ups, snagging/making-good"],
    ],
  },
  {
    label: "Structural & Civil",
    units: [
      ["m³", "excavation, backfill, hardcore, PCC/RC concrete by volume"],
      ["m²", "formwork, masonry/blockwork walls, paving, road surfacing by area"],
      ["ton", "reinforcement & structural steel by weight (bulk)"],
      ["kg", "light steelwork, embedded steel, small fabrications by weight"],
      ["m", "kerbs, edge restraints, linear drains/channels"],
      ["EA", "manholes, gully pits, precast units, footings as counted"],
      ["LS", "demolition, dewatering, shoring as a lump where not measurable"],
    ],
  },
  {
    label: "Site Survey & Investigation",
    units: [
      ["LS", "topographic survey, geotechnical investigation, utility locating, setting-out as a lump"],
      ["EA", "boreholes, trial pits, test points as counted"],
      ["m²", "area surveyed / mapped where measured by area"],
    ],
  },
  {
    label: "Design & Submittals",
    units: [
      ["LS", "design stages, calculations, submittals, O&M manuals — priced as lump deliverables"],
      ["PM", "design staffing (engineers/draughtsmen) where priced by time"],
    ],
  },
  {
    label: "Mobilization & Demobilization",
    units: [
      ["LS", "mobilization, site setup, temporary works, demobilization as lump items"],
      ["m", "temporary fencing/hoarding by length where measured"],
      ["PM", "site facilities/security retained by time (person-month)"],
    ],
  },
  {
    label: "Closeout & As-Built",
    units: [
      ["LS", "as-built drawings, DD 1354, warranties, O&M training, handover docs — lump deliverables"],
    ],
  },
];

/** Compact reference block for the section-agent and verifier prompts. */
export function formatDisciplineUnitsForPrompt() {
  return DISCIPLINE_UNITS.map(
    (d) => `- ${d.label}: ${d.units.map(([token, use]) => `${token} (${use})`).join("; ")}`
  ).join("\n");
}
