/**
 * Discipline checklist used by the completeness-verifier in the SOW-driven
 * pipeline. The section agents work top-down from the SOW; this list works
 * bottom-up from "what kinds of items should appear in a typical project"
 * so the verifier can spot scope gaps the SOW didn't explicitly call out.
 *
 * Each entry captures (a) the discipline's surface area and (b) the SOW
 * section types it usually shows up under — so the verifier can map a missing
 * discipline back to a specific section to add items to.
 */

export interface DisciplineSpec {
  key: string;
  label: string;
  coverage: string;
  triggers: string[];
  /**
   * Lower-case keyword/phrase fragments used to classify a BOQ line item into
   * this discipline (a "department") for the per-department Excel export. Items
   * are scored against every discipline's keywords; the highest scorer wins.
   * Order in DISCIPLINE_CHECKLIST breaks ties (earlier = higher priority).
   */
  keywords: string[];
  /**
   * This discipline's INDEPENDENT standard unit set — the subset of the global
   * standard tokens (see boq-units.ts) that is correct for THIS discipline's
   * lines. MEP disciplines (HVAC, electrical, plumbing) each carry their own
   * set so e.g. a chiller is EA/Set, ductwork is kg, cabling is m — rather than
   * every discipline sharing one flat list. Each entry is "<token> — <what it
   * measures here>". Surfaced to the section agents and the completeness
   * verifier via formatDisciplineUnitsForPrompt(); the global normalizeUnit()
   * still standardises the token spelling itself.
   */
  units: Array<{ token: string; use: string }>;
}

export const DISCIPLINE_CHECKLIST: DisciplineSpec[] = [
  {
    key: "lighting",
    label: "Lighting",
    coverage:
      "Interior LED luminaires, exterior floods, emergency lighting, exit signs, lighting controls (sensors, dimmers, DALI/DMX).",
    triggers: ["building fit-out", "facility lighting upgrade", "exterior lighting", "site lighting"],
    keywords: [
      "luminaire", "lighting", "light fitting", "lamp", "led", "floodlight", "flood light",
      "emergency light", "exit sign", "downlight", "spotlight", "dimmer", "dali", "dmx",
      "lux", "lighting control",
    ],
    units: [
      { token: "EA", use: "luminaires, fittings, exit/emergency units, sensors, dimmers, controllers" },
      { token: "m", use: "lighting track, festoon/exterior lighting cable runs" },
      { token: "LS", use: "lighting controls commissioning, scene programming, general wiring" },
    ],
  },
  {
    key: "electrical",
    label: "Electrical Power",
    coverage:
      "MDBs/SDBs/FDBs, LV switchgear, power cabling and containment, earthing, sockets, UPS, gensets, transformers.",
    triggers: ["any new building", "pump replacement", "new equipment power", "electrical upgrade"],
    keywords: [
      "mdb", "sdb", "fdb", "distribution board", "switchgear", "switchboard", "lv panel",
      "cable", "cabling", "containment", "cable tray", "trunking", "earthing", "earth pit",
      "socket", "socket outlet", "ups", "genset", "generator", "transformer", "busbar",
      "circuit breaker", "mccb", "mcb", "power", "electrical", "conduit", "wiring", "isolator",
    ],
    units: [
      { token: "m", use: "power/control cabling, conduit, cable tray, trunking, busbar trunking, containment" },
      { token: "EA", use: "MDB/SDB/FDB, panels, breakers, isolators, sockets, switches, wiring points" },
      { token: "Set", use: "gensets, transformers, UPS, capacitor banks supplied as one assembly" },
      { token: "LS", use: "general/small-power wiring, earthing & bonding system, testing & commissioning" },
    ],
  },
  {
    key: "hvac",
    label: "HVAC",
    coverage:
      "Chillers, AHUs, FCUs, VRF, ductwork, diffusers, exhaust fans, controls, refrigerant piping, condensate drainage.",
    triggers: ["building interior", "occupied space conditioning"],
    keywords: [
      "chiller", "ahu", "air handling", "fcu", "fan coil", "vrf", "vrv", "ductwork", "duct",
      "diffuser", "grille", "exhaust fan", "ventilation", "refrigerant", "condensate",
      "air conditioning", "air-conditioning", "hvac", "cooling", "split unit", "package unit",
      "damper", "thermostat",
    ],
    units: [
      { token: "EA", use: "chillers, AHUs, FCUs, VRF units, exhaust fans, diffusers, grilles, dampers, thermostats" },
      { token: "Set", use: "packaged/split AC systems & plant supplied as one set" },
      { token: "kg", use: "GI/sheet-metal ductwork by weight" },
      { token: "m²", use: "duct & refrigerant-pipe thermal insulation" },
      { token: "m", use: "refrigerant piping, condensate drainage runs" },
      { token: "LS", use: "TAB (testing, adjusting & balancing), controls integration, commissioning" },
    ],
  },
  {
    key: "plumbing",
    label: "Plumbing, Drainage & Fire",
    coverage:
      "Cold/hot water supply, fittings/valves, sanitary fixtures, soil/waste/vent, roof drainage, tanks, sprinklers, hydrants, hose reels.",
    triggers: ["sewage works", "lift station", "wet area", "building plumbing", "fire suppression"],
    keywords: [
      "water supply", "cold water", "hot water", "valve", "gate valve", "sanitary", "fixture",
      "wc", "lavatory", "wash basin", "sink", "soil pipe", "waste pipe", "vent pipe", "drainage",
      "drain", "manhole", "gully", "water tank", "sprinkler", "hydrant", "hose reel", "plumbing",
      "pipe", "piping", "pump", "sewage", "sewer", "fire fighting", "fire suppression", "ppr",
      "upvc", "gi pipe",
    ],
    units: [
      { token: "m", use: "cold/hot water supply, soil/waste/vent, drainage piping, sprinkler/hydrant mains" },
      { token: "EA", use: "sanitary fixtures, valves, tanks, water heaters, floor drains, hydrants, hose reels" },
      { token: "Set", use: "booster/transfer/sewage pumps & pump sets" },
      { token: "m²", use: "wet-area waterproofing / tanking" },
      { token: "LS", use: "pressure testing, disinfection, fire-system commissioning" },
    ],
  },
  {
    key: "doors",
    label: "Doors, Windows & Façade",
    coverage:
      "Internal/external doors, frames, hardware, windows, curtain walls, glazing, shopfronts, skylights.",
    triggers: ["new building", "fit-out", "envelope works"],
    keywords: [
      "door", "door frame", "ironmongery", "door hardware", "hinge", "lockset", "window",
      "curtain wall", "glazing", "glazed", "shopfront", "skylight", "facade", "façade",
      "louvre", "rolling shutter", "aluminium window", "aluminum window",
    ],
    units: [
      { token: "EA", use: "doors, windows, shutters, louvres, ironmongery sets, skylights as units" },
      { token: "m²", use: "curtain walling, structural glazing, shopfront/glazed screen area" },
      { token: "m", use: "door/window framing, sub-frames, trims by length" },
    ],
  },
  {
    key: "roofing",
    label: "Roofing & Waterproofing",
    coverage:
      "Roof sheeting/membranes, metal & sandwich-panel roofs, purlins/rafters, thermal insulation, vapour barriers, waterproofing, parapets, flashings, fascia/soffit, skylights.",
    triggers: ["new building", "re-roofing", "envelope works", "warehouse", "industrial shed"],
    keywords: [
      "roof", "roofing", "roof sheet", "roof sheeting", "roof cladding", "metal roof",
      "sandwich panel", "purlin", "rafter", "ridge", "parapet", "flashing", "waterproofing",
      "waterproof membrane", "roof membrane", "vapour barrier", "vapor barrier",
      "roof insulation", "thermal insulation", "fascia", "soffit",
    ],
    units: [
      { token: "ton", use: "metal/steel roof sheeting, sandwich panels, purlins/rafters & roof structure by weight" },
      { token: "m²", use: "waterproof/roof membrane, thermal insulation, vapour barrier by area" },
      { token: "m", use: "flashing, ridge, edge trim, fascia/soffit by length" },
      { token: "EA", use: "skylights, roof vents/hatches, roof accessories" },
    ],
  },
  {
    key: "finishes",
    label: "Architectural Finishes",
    coverage:
      "Floor/wall/ceiling finishes, tiles, paints, partitions, raised access floors, gypsum boards, external render.",
    triggers: ["new building", "fit-out", "renovation"],
    keywords: [
      "floor finish", "wall finish", "ceiling", "false ceiling", "tile", "tiling", "paint",
      "painting", "partition", "raised access floor", "gypsum", "plasterboard", "render",
      "rendering", "plaster", "screed", "skirting", "cladding", "vinyl", "epoxy floor", "finish",
    ],
    units: [
      { token: "m²", use: "floor/wall/ceiling finishes, tiling, plaster/render, painting, partitions, cladding, screed" },
      { token: "m", use: "skirting, cornices, beading, trims by length" },
      { token: "EA", use: "raised-floor pedestals as counted, finish accessories/fittings" },
      { token: "LS", use: "sample boards, mock-ups, snagging/making-good" },
    ],
  },
  {
    key: "structural",
    label: "Structural & Civil",
    coverage:
      "Excavation, piling, foundations, RC frame, steel frame, masonry, paving, roads, drainage manholes, kerbs.",
    triggers: ["site works", "new structure", "earthworks", "lift station", "concrete works", "demolition"],
    keywords: [
      "excavation", "piling", "pile", "foundation", "footing", "rc ", "reinforced concrete",
      "concrete", "rebar", "reinforcement", "steel frame", "structural steel", "masonry",
      "blockwork", "block work", "brickwork", "paving", "road", "asphalt", "kerb", "curb",
      "backfill", "earthwork", "demolition", "formwork", "slab", "column", "beam", "civil",
    ],
    units: [
      { token: "m³", use: "excavation, backfill, hardcore, PCC/RC concrete by volume" },
      { token: "m²", use: "formwork, masonry/blockwork walls, paving, road surfacing by area" },
      { token: "ton", use: "reinforcement & structural steel by weight (bulk)" },
      { token: "kg", use: "light steelwork, embedded steel, small fabrications by weight" },
      { token: "m", use: "kerbs, edge restraints, linear drains/channels" },
      { token: "EA", use: "manholes, gully pits, precast units, footings as counted" },
      { token: "LS", use: "demolition, dewatering, shoring as a lump where not measurable" },
    ],
  },
  {
    key: "site-survey",
    label: "Site Survey & Investigation",
    coverage:
      "Topographic survey, geotechnical investigation, existing conditions documentation, utility locating.",
    triggers: ["any new construction or repair"],
    keywords: [
      "site survey", "topographic", "topographical", "geotechnical", "soil investigation",
      "site investigation", "borehole", "utility locating", "existing condition", "setting out",
      "survey",
    ],
    units: [
      { token: "LS", use: "topographic survey, geotechnical investigation, utility locating, setting-out as a lump" },
      { token: "EA", use: "boreholes, trial pits, test points as counted" },
      { token: "m²", use: "area surveyed / mapped where measured by area" },
    ],
  },
  {
    key: "design",
    label: "Design & Submittals",
    coverage:
      "65%/95%/100% design drawings, design calculations, material/technical submittals, O&M manuals.",
    triggers: ["design-build", "any AIGCC priced BOQ"],
    keywords: [
      "design drawing", "design calculation", "design submittal", "shop drawing", "65%", "95%",
      "100% design", "material submittal", "technical submittal", "o&m manual", "engineering design",
      "design and ", "detailed design",
    ],
    units: [
      { token: "LS", use: "design stages, calculations, submittals, O&M manuals — priced as lump deliverables" },
      { token: "PM", use: "design staffing (engineers/draughtsmen) where priced by time" },
    ],
  },
  {
    key: "mob-demob",
    label: "Mobilization & Demobilization",
    coverage:
      "Staging area, storage, temporary utilities, signage, fencing, debris removal, delivery, safety setup.",
    triggers: ["any project"],
    keywords: [
      "mobilization", "mobilisation", "demobilization", "demobilisation", "staging area",
      "site setup", "temporary utilities", "temporary fence", "site signage", "debris removal",
      "site safety", "hoarding", "site office", "welfare facilities",
    ],
    units: [
      { token: "LS", use: "mobilization, site setup, temporary works, demobilization as lump items" },
      { token: "m", use: "temporary fencing/hoarding by length where measured" },
      { token: "PM", use: "site facilities/security retained by time (person-month)" },
    ],
  },
  {
    key: "closeout",
    label: "Closeout & As-Built",
    coverage:
      "As-built drawings (AutoCAD + PDF), DD Form 1354, warranties, O&M training, closeout documentation.",
    triggers: ["any USAF/MEW project"],
    keywords: [
      "as-built", "as built", "dd 1354", "dd form", "dd form 1354", "warranty", "warranties",
      "o&m training", "closeout", "close-out", "handover", "commissioning certificate",
    ],
    units: [
      { token: "LS", use: "as-built drawings, DD 1354, warranties, O&M training, handover docs — lump deliverables" },
    ],
  },
];

/** Label used for items that don't match any discipline's keywords. */
export const UNCLASSIFIED_DEPARTMENT = "General";

/**
 * Classify a BOQ line item into a discipline ("department") by keyword-matching
 * its searchable text (category + description + notes) against every
 * discipline's keyword set. Returns the highest-scoring discipline, or null if
 * nothing matches (caller falls back to UNCLASSIFIED_DEPARTMENT).
 *
 * Scoring: +1 per distinct keyword that appears in the text; ties are broken by
 * checklist order (earlier disciplines win). Longer keyword phrases are matched
 * as substrings so multi-word signals ("water supply") beat bare words.
 */
export function classifyDiscipline(text: string): DisciplineSpec | null {
  const haystack = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  let best: DisciplineSpec | null = null;
  let bestScore = 0;
  for (const spec of DISCIPLINE_CHECKLIST) {
    let score = 0;
    for (const kw of spec.keywords) {
      if (haystack.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = spec;
    }
  }
  return best;
}

/**
 * Render the checklist as a compact text block for the completeness verifier
 * prompt. Each line is a separate scope area the verifier should confirm is
 * represented in the produced BOQ.
 */
export function formatChecklistForPrompt(): string {
  return DISCIPLINE_CHECKLIST.map(d => `- ${d.label}: ${d.coverage}`).join("\n");
}

/**
 * Render each discipline's INDEPENDENT standard unit set as a compact reference
 * block for the section-agent and verifier prompts. This is what makes MEP
 * (and every other discipline) carry its own units instead of sharing one flat
 * list: when an agent writes a chiller line it sees HVAC → EA/Set, a cable line
 * sees Electrical → m, a steel-roof line sees Roofing → ton. The global
 * normalizeUnit() still standardises token SPELLING; this only steers token
 * CHOICE per discipline.
 */
export function formatDisciplineUnitsForPrompt(): string {
  return DISCIPLINE_CHECKLIST.map(d => {
    const tokens = d.units.map(u => `${u.token} (${u.use})`).join("; ");
    return `- ${d.label}: ${tokens}`;
  }).join("\n");
}
