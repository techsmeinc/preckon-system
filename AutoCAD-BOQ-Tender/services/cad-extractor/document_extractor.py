"""Generic PDF text extractor for *non-drawing* documents.

Tender packages, RFPs, SOWs, technical specifications, addenda — these are
text PDFs where you want section-aware chunks, not per-page drawing chunks.
We detect headings by font size (heuristic: any line whose largest span size
is ≥ 1.3× the document median is treated as a heading boundary) and split
the document into sections accordingly. Long sections are further split at
character boundaries so single chunks stay small enough for embedding.

The output shape is deliberately distinct from the drawing extractor so the
Node side can tell them apart and emit different chunk types.
"""

from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass, field
from typing import Any

try:
    import pymupdf as fitz  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    import fitz  # type: ignore[no-redef]


# Tuning knobs. These work well for typical tender docs (Times/Arial body
# around 10–11 pt, headings around 13–16 pt). Adjust if you see the chunker
# treating every line as a heading.
HEADING_RATIO = 1.25
HEADING_MAX_CHARS = 120
TARGET_CHUNK_CHARS = 1200
MAX_SECTION_CHARS = 6000  # hard cap before forced split

# Table detection is the single most expensive step for large text PDFs:
# PyMuPDF.find_tables() analyses each page's vector graphics and runs in the
# ~100–200 ms/page range, so a 130-page spec spends 15–25 s here alone — often
# finding nothing on a narrative document. We fan the per-page scan out across
# processes (find_tables is CPU-bound and the GIL serialises threads). For
# small docs the spawn overhead isn't worth it, so we stay sequential below the
# threshold. Both knobs are env-tunable on the VPS.
TABLE_PARALLEL_MIN_PAGES = int(os.environ.get("CAD_TABLE_PARALLEL_MIN_PAGES", "16") or 16)
TABLE_MAX_WORKERS = int(os.environ.get("CAD_TABLE_MAX_WORKERS", "8") or 8)


@dataclass
class DocumentChunk:
    """One section-shaped chunk of a text document."""

    heading: str
    page_start: int
    page_end: int
    text: str


@dataclass
class DocumentSchedule:
    """One table extracted from a document-mode PDF (quantity table, price
    schedule, specs table, etc.). Mirrors the schedule shape used by the
    drawing-PDF extractor so the Node ingest can treat both the same way."""

    page: int
    header: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    row_count: int = 0


@dataclass
class DocumentExtraction:
    kind: str = "document"
    file: str = ""
    page_count: int = 0
    text_total_chars: int = 0
    median_font_size: float = 0.0
    heading_threshold: float = 0.0
    chunks: list[DocumentChunk] = field(default_factory=list)
    schedules: list[DocumentSchedule] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "file": self.file,
            "pageCount": self.page_count,
            "textTotalChars": self.text_total_chars,
            "medianFontSize": self.median_font_size,
            "headingThreshold": self.heading_threshold,
            "chunks": [asdict(c) for c in self.chunks],
            "schedules": [
                {
                    "page": s.page,
                    "header": s.header,
                    "rows": s.rows,
                    "row_count": s.row_count,
                }
                for s in self.schedules
            ],
            "warnings": self.warnings,
        }


def _line_spans(page) -> list[dict[str, Any]]:
    """Flatten a page into a list of {text, size, page, y} per *line* of text."""
    out: list[dict[str, Any]] = []
    page_dict = page.get_text("dict")
    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            line_text_parts: list[str] = []
            max_size = 0.0
            for s in spans:
                t = (s.get("text") or "").strip()
                if not t:
                    continue
                line_text_parts.append(t)
                max_size = max(max_size, float(s.get("size") or 0))
            if not line_text_parts:
                continue
            bbox = line.get("bbox") or [0, 0, 0, 0]
            out.append({
                "text": " ".join(line_text_parts),
                "size": max_size,
                "page": page.number,
                "y": float(bbox[1]),
            })
    return out


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _flush_chunk(
    result: DocumentExtraction,
    heading: str,
    page_start: int,
    page_end: int,
    body: list[str],
) -> None:
    """Emit a single chunk; if the body is huge, split it at character boundaries.
    We preserve the heading on every split part so retrieval results stay
    interpretable."""
    if not body:
        return
    joined = "\n".join(body).strip()
    if not joined:
        return
    # Small enough to keep as one chunk.
    if len(joined) <= TARGET_CHUNK_CHARS * 1.5:
        result.chunks.append(DocumentChunk(
            heading=heading, page_start=page_start, page_end=page_end, text=joined,
        ))
        return
    # Larger sections are sliding-window split (small overlap so cross-boundary
    # phrases survive) — NO upper truncation. Heading detection can fail
    # entirely on a spec with no large-font headings, collapsing the whole
    # document into one section; truncating that to MAX_SECTION_CHARS used to
    # silently discard nearly all of a long spec's text before it reached the
    # BOQ agents. We always chunk through to the end instead.
    if len(joined) > MAX_SECTION_CHARS:
        result.warnings.append(
            f'section "{heading[:40]}" is {len(joined)} chars '
            f"(no headings detected?) — split into windowed chunks"
        )
    step = TARGET_CHUNK_CHARS
    overlap = 150
    i = 0
    part = 1
    while i < len(joined):
        piece = joined[i:i + step + overlap]
        result.chunks.append(DocumentChunk(
            heading=f"{heading} — part {part}",
            page_start=page_start, page_end=page_end,
            text=piece,
        ))
        i += step
        part += 1


def _tables_on_page(page) -> tuple[list[dict[str, Any]], list[str]]:
    """Extract every table on a single page as plain (picklable) dicts.

    Returns (schedules, warnings). Plain dicts rather than DocumentSchedule so
    the result can cross a process boundary when the scan is parallelised.
    """
    schedules: list[dict[str, Any]] = []
    warnings: list[str] = []
    try:
        finder = page.find_tables()
    except Exception as exc:  # noqa: BLE001 — defensive, find_tables can crash on malformed PDFs
        return schedules, [f"find_tables crashed on page {page.number + 1}: {exc!r}"]

    tables = getattr(finder, "tables", None) or []
    for table in tables:
        try:
            # extract() returns a list[list[str|None]] with the header
            # as the first row. We normalise None → "" and strip cells.
            grid = table.extract()
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"table.extract crashed on page {page.number + 1}: {exc!r}")
            continue
        if not grid:
            continue
        # Use the table's header attribute when available; otherwise treat
        # the first row as header.
        tb_header_obj = getattr(table, "header", None)
        header_cells: list[str] = []
        if tb_header_obj is not None and getattr(tb_header_obj, "names", None):
            header_cells = [str(c or "").strip() for c in tb_header_obj.names]
            body_rows = grid[1:] if getattr(tb_header_obj, "external", False) is False else grid
        else:
            header_cells = [str(c or "").strip() for c in grid[0]]
            body_rows = grid[1:]
        # Drop fully-empty header
        if not any(header_cells):
            # Synthesise a generic header so downstream code has something
            width = max((len(r) for r in body_rows), default=0)
            header_cells = [f"col{i + 1}" for i in range(width)]
        body_rows_norm = [[str(c or "").strip() for c in row] for row in body_rows]
        # Drop fully-empty rows
        body_rows_norm = [r for r in body_rows_norm if any(r)]
        if not body_rows_norm:
            continue
        schedules.append({
            "page": page.number,
            "header": header_cells,
            "rows": body_rows_norm,
            "row_count": len(body_rows_norm),
        })
    return schedules, warnings


def _tables_in_range(args: tuple[str, int, int]) -> tuple[list[dict[str, Any]], list[str]]:
    """Worker target: open the doc independently and scan a page range. Runs in
    a separate process, so it must take a path (not a Document) and return only
    picklable data."""
    path, start, end = args
    schedules: list[dict[str, Any]] = []
    warnings: list[str] = []
    try:
        doc = fitz.open(path)
    except Exception as exc:  # noqa: BLE001
        return [], [f"table worker failed to open doc: {exc!r}"]
    try:
        for i in range(start, min(end, doc.page_count)):
            s, w = _tables_on_page(doc.load_page(i))
            schedules.extend(s)
            warnings.extend(w)
    finally:
        doc.close()
    return schedules, warnings


def _extract_tables(doc, result: DocumentExtraction, path: str) -> None:
    """Detect tables on every page using PyMuPDF's built-in table finder.

    Why this matters for BOQ work: tender PDFs almost always include
    quantity tables, price schedules, item lists, technical specification
    tables — these are GOLD for the BOQ pipeline because they map directly
    to line items. Loose text extraction loses table structure (cell
    boundaries become whitespace), so the LLM has to re-parse rows out of
    paragraphs. PyMuPDF.find_tables() reconstructs the cell grid and gives
    us proper header + rows.

    find_tables() is CPU-bound and slow (~100–200 ms/page). For large docs we
    fan the scan out across processes; small docs stay sequential to dodge the
    process-spawn overhead. Detected tables are collected in page order.
    """
    page_count = doc.page_count
    collected: list[dict[str, Any]] = []

    use_parallel = page_count >= TABLE_PARALLEL_MIN_PAGES and TABLE_MAX_WORKERS > 1
    if use_parallel:
        workers = max(2, min(TABLE_MAX_WORKERS, (os.cpu_count() or 2), page_count))
        chunk = (page_count + workers - 1) // workers
        ranges = [(path, i, i + chunk) for i in range(0, page_count, chunk)]
        try:
            with ProcessPoolExecutor(max_workers=workers) as ex:
                for schedules, warnings in ex.map(_tables_in_range, ranges):
                    collected.extend(schedules)
                    result.warnings.extend(warnings)
        except Exception as exc:  # noqa: BLE001 — pool can fail to spawn; fall back to sequential
            result.warnings.append(f"parallel table scan failed ({exc!r}); fell back to sequential")
            use_parallel = False

    if not use_parallel:
        for page in doc:
            schedules, warnings = _tables_on_page(page)
            collected.extend(schedules)
            result.warnings.extend(warnings)

    # Keep tables in page order regardless of which worker produced them.
    collected.sort(key=lambda s: s["page"])
    for s in collected:
        result.schedules.append(DocumentSchedule(
            page=s["page"],
            header=s["header"],
            rows=s["rows"],
            row_count=s["row_count"],
        ))


def extract_document(path: str) -> dict[str, Any]:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    doc = fitz.open(path)
    result = DocumentExtraction(file=os.path.basename(path), page_count=doc.page_count)

    # First pass: gather all line metadata so we can pick a font-size threshold.
    all_lines: list[dict[str, Any]] = []
    for page in doc:
        all_lines.extend(_line_spans(page))

    # Tables — run regardless of whether there's flowing text. A doc may be
    # mostly tables (e.g. a quantity schedule PDF).
    _extract_tables(doc, result, path)

    if not all_lines:
        if not result.schedules:
            result.warnings.append("no extractable text — this PDF may be a scanned image (OCR required)")
        else:
            result.warnings.append(
                f"no flowing text — document looks table-only ({len(result.schedules)} table(s) extracted)"
            )
        doc.close()
        return result.to_dict()

    sizes = [l["size"] for l in all_lines if l["size"] > 0]
    median_size = _median(sizes)
    heading_threshold = median_size * HEADING_RATIO
    result.median_font_size = median_size
    result.heading_threshold = heading_threshold

    # Second pass: walk lines in document order, splitting at heading-like lines.
    current_heading = "Document Start"
    current_page_start = 0
    current_page_end = 0
    current_body: list[str] = []

    for line in all_lines:
        is_heading = (
            line["size"] >= heading_threshold
            and len(line["text"]) <= HEADING_MAX_CHARS
            and len(line["text"]) >= 3
        )
        if is_heading:
            _flush_chunk(result, current_heading, current_page_start, current_page_end, current_body)
            current_heading = line["text"]
            current_page_start = line["page"]
            current_page_end = line["page"]
            current_body = []
        else:
            current_body.append(line["text"])
            current_page_end = line["page"]

    _flush_chunk(result, current_heading, current_page_start, current_page_end, current_body)

    result.text_total_chars = sum(len(c.text) for c in result.chunks)
    doc.close()
    return result.to_dict()
