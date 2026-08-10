// Saving a drawing without destroying the parts we cannot draw.
//
// THE PROBLEM THIS EXISTS FOR
//
// The editor's model understands three things: lines, polylines and text. A
// real issued drawing contains far more than that — block references (every
// door, window, sanitary fixture and drawing tag is an INSERT), dimensions,
// hatches, splines, ellipses, attributes, linetypes, lineweights, xref mounts.
// `parseToModel` drops all of it, and `serializeModel` then writes a brand new
// R12 file out of the three kinds that survived.
//
// So marking up an issued sheet and saving it did not annotate the drawing. It
// replaced the drawing with a tracing of the bits we happened to understand,
// and the doors, the dimensions and the hatching were gone. On a set that a
// bill is priced from, that is not a rough edge — it is a drawing nobody can
// use, produced by an action labelled "Save".
//
// THE FIX
//
// Never rewrite what we did not read. The original file is kept as text and
// treated as the source of truth. The parsed model is an OVERLAY: an editable
// view of the parts we understand. On save the original file is re-emitted
// verbatim, minus the entities the user deleted or changed, plus the ones they
// drew. A hatch we cannot render still comes out the other side byte for byte,
// because nothing here ever looked at it.
//
// This is what makes the editor safe on drawings it does not fully understand —
// which is all of them, and always will be.

/** One entity as it appears in the file, kept exactly as written. */
export interface EntityChunk {
  /** DXF handle (group code 5), the only stable identity in the format. */
  handle: string | null;
  /** LINE, INSERT, HATCH… — for diagnostics, never for interpretation. */
  type: string;
  /** The verbatim text, reproduced unchanged when the entity is kept. */
  text: string;
}

export interface DxfIndex {
  /** Everything up to and including the ENTITIES section marker. */
  head: string;
  chunks: EntityChunk[];
  /** ENDSEC onwards — OBJECTS, classes, the lot. */
  tail: string;
}

/** Entities that are continuations of the one before, not entities in their own
 *  right. A POLYLINE is followed by its VERTEX records and a SEQEND; splitting
 *  them apart would let a save keep a polyline's header and drop its points. */
const CONTINUATION = new Set(["VERTEX", "SEQEND", "ATTRIB"]);

/**
 * Split a DXF into its entities without interpreting any of them.
 *
 * Deliberately a text operation. A parse-and-reserialise round trip loses
 * whatever the parser did not model — which is the exact failure this module
 * exists to prevent — so the file is only ever cut and rejoined.
 *
 * Returns null when the file has no ENTITIES section, which means it is not
 * something we can safely rewrite and the caller should fall back.
 */
export function indexDxf(text: string): DxfIndex | null {
  const lines = text.split(/\r?\n/);

  // Find "0 / SECTION / 2 / ENTITIES", then the ENDSEC that closes it.
  let start = -1;
  for (let i = 0; i + 3 < lines.length; i++) {
    if (
      lines[i].trim() === "0" && lines[i + 1].trim() === "SECTION" &&
      lines[i + 2].trim() === "2" && lines[i + 3].trim() === "ENTITIES"
    ) { start = i + 4; break; }
  }
  if (start < 0) return null;

  let end = -1;
  for (let i = start; i + 1 < lines.length; i++) {
    if (lines[i].trim() === "0" && lines[i + 1].trim() === "ENDSEC") { end = i; break; }
  }
  if (end < 0) return null;

  const chunks: EntityChunk[] = [];
  let cur: string[] = [];
  let curType = "";

  const flush = () => {
    if (!cur.length) return;
    if (CONTINUATION.has(curType) && chunks.length) {
      // Belongs to the entity before it — append rather than stand alone.
      chunks[chunks.length - 1].text += cur.join("\n") + "\n";
    } else {
      chunks.push({ handle: handleOf(cur), type: curType, text: cur.join("\n") + "\n" });
    }
    cur = [];
  };

  // Stepped in PAIRS, because a DXF is strictly alternating code line then
  // value line — and "0" is a perfectly ordinary value. A line-by-line scan
  // for "0" cuts a new entity at every y-coordinate that happens to be zero,
  // which on a real drawing is hundreds of them: the file comes apart into
  // fragments, the handles read as blank, and a polyline loses its vertices.
  // Parity is the whole difference between reading DXF and reading text.
  for (let i = start; i + 1 < end; i += 2) {
    if (lines[i].trim() === "0") {
      flush();
      curType = lines[i + 1].trim();
    }
    cur.push(lines[i], lines[i + 1]);
  }
  // An odd trailing line is not valid DXF, but dropping it would corrupt the
  // file silently. Carry it through.
  if ((end - start) % 2 === 1) cur.push(lines[end - 1]);
  flush();

  return {
    head: lines.slice(0, start).join("\n") + "\n",
    chunks,
    tail: lines.slice(end).join("\n"),
  };
}

/**
 * The handle, which is group code 5 at entity level.
 *
 * Read only from the top of the record, before any subclass marker (code 100).
 * Past that point a 5 can belong to something else entirely — a reactor list,
 * an extension dictionary — and picking one of those up would tie an edit to
 * the wrong entity.
 */
function handleOf(lines: string[]): string | null {
  // In pairs, for the same reason as the scan above: an entity whose colour is
  // 5 would otherwise hand back the next line as its handle.
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim();
    if (code === "100") break;
    if (code === "5") return lines[i + 1].trim();
  }
  return null;
}

/**
 * Re-emit the file with some entities removed and some added.
 *
 * Everything not named in `drop` is reproduced exactly as it was read — that is
 * the whole promise. `add` is appended as already-serialised DXF text.
 */
export function rewriteDxf(index: DxfIndex, drop: Set<string>, add: string): string {
  const kept = index.chunks
    .filter((c) => !(c.handle !== null && drop.has(c.handle)))
    .map((c) => c.text)
    .join("");
  return index.head + kept + (add.endsWith("\n") || !add ? add : add + "\n") + index.tail;
}

/**
 * The largest handle in the file, so new entities can be given ones that do not
 * collide. Handles are hexadecimal, and a duplicate is the kind of corruption
 * that opens fine in one CAD package and not in another.
 */
export function maxHandle(index: DxfIndex): number {
  let max = 0;
  for (const c of index.chunks) {
    if (!c.handle) continue;
    const n = parseInt(c.handle, 16);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * Save an edited model back over the drawing it came from.
 *
 * Entities that still carry a handle were never touched, so their original
 * records are reproduced verbatim — along with every INSERT, HATCH, DIMENSION,
 * SPLINE and ELLIPSE the model never saw. Entities without one are new or
 * edited, and are appended. Anything in the file whose handle no longer appears
 * in the model was deleted, and is dropped.
 *
 * Falls back to a fresh R12 file when there is nothing to preserve — a drawing
 * created from scratch, or a source we could not index. The caller does not
 * need to know which happened; both are a valid DXF.
 */
export function saveOver(
  source: string | null,
  model: { entities: Array<{ handle?: string }> },
  freshFile: () => string,
  newEntities: (es: Array<{ handle?: string }>) => string,
): string {
  const index = source ? indexDxf(source) : null;
  if (!index) return freshFile();

  const kept = new Set<string>();
  const added: Array<{ handle?: string }> = [];
  for (const e of model.entities) {
    if (e.handle) kept.add(e.handle);
    else added.push(e);
  }

  const drop = new Set<string>();
  for (const c of index.chunks) if (c.handle && !kept.has(c.handle)) drop.add(c.handle);

  const body = newEntities(added);
  return rewriteDxf(index, drop, body ? body + "\n" : "");
}
