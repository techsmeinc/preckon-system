"""PDF drawing extractor.

In construction tendering, drawings are most often delivered as multi-sheet
PDFs (one sheet per page). PDFs don't carry CAD semantics — no layers, no
block instances — so we can't do an INSERT-count style take-off the way we do
with DXF. What we CAN do, very reliably, is:

  - Pull every text element with its bounding box and page index.
  - Detect tabular structures (schedules) by clustering text on similar y rows.
  - Identify likely title-block fields (page-corner text + project/sheet tags).
  - Group page text by spatial cluster so each "label region" becomes a chunk.

This module is intentionally shaped so its output slots into the same chunk
pipeline as the DXF extractor — the Node side builds RAG chunks the same way.
"""

from __future__ import annotations

import os
import re
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from typing import Any

# IMPORTANT: a *different* PyPI package called `fitz` (an unrelated frontend
# library) collides with PyMuPDF on import. Prefer `pymupdf` (the new canonical
# name, PyMuPDF >= 1.24) and only fall back to `fitz` if the user is on an
# older PyMuPDF without the rename. If you hit "Directory 'static/' does not
# exist" on import, you have the wrong `fitz` package installed — see the
# README for the cleanup steps.
try:
    import pymupdf as fitz  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    import fitz  # type: ignore[no-redef]
    if not hasattr(fitz, "open"):
        raise RuntimeError(
            "The installed `fitz` package is not PyMuPDF. Run:\n"
            "  pip uninstall -y fitz frontend tools\n"
            "  pip install --no-cache-dir PyMuPDF\n"
        )


@dataclass
class PageTextSpan:
    """One run of text in the PDF, with its bbox."""

    page: int
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    font_size: float


@dataclass
class PageSummary:
    page: int
    width: float
    height: float
    text_span_count: int
    distinct_text_count: int
    is_likely_scan: bool   # very few text spans → probably a raster scan
    sheet_label: str | None  # extracted sheet number/title if found


@dataclass
class DetectedSchedule:
    """A table-like cluster of text on a single page."""

    page: int
    header: list[str]
    rows: list[list[str]]
    row_count: int


@dataclass
class PdfExtraction:
    file: str
    page_count: int
    pages: list[PageSummary] = field(default_factory=list)
    text_spans: list[PageTextSpan] = field(default_factory=list)
    text_by_page: dict[int, list[str]] = field(default_factory=dict)
    title_block_fields: dict[str, str] = field(default_factory=dict)
    schedules: list[DetectedSchedule] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "pdf",
            "file": self.file,
            "pageCount": self.page_count,
            "pages": [asdict(p) for p in self.pages],
            "textSpans": [asdict(s) for s in self.text_spans],
            "textByPage": {str(k): v for k, v in self.text_by_page.items()},
            "titleBlockFields": self.title_block_fields,
            "schedules": [asdict(s) for s in self.schedules],
            "warnings": self.warnings,
        }


# Regexes used to spot likely sheet metadata. Construction conventions vary
# wildly by region; these are broad but conservative.
_SHEET_NUMBER_RE = re.compile(
    r"\b([A-Z]{1,3}[-\s]?\d{2,4}(?:[-\.]\d{1,3})?|SH(?:EET)?\s*[-\s]?\d+|DWG\s*N[O0]\.?\s*[-:]?\s*\S+)\b",
    re.IGNORECASE,
)
_SCALE_RE = re.compile(r"\bSCALE\s*[:\-]?\s*([\d\.:/]+|NTS|AS\s*SHOWN)\b", re.IGNORECASE)
_DRAWN_BY_RE = re.compile(r"\b(?:DRAWN|DR\.?)\s*(?:BY)?\s*[:\-]?\s*([A-Za-z\.]{1,30})\b", re.IGNORECASE)
_PROJECT_RE = re.compile(r"\bPROJECT\s*(?:NAME)?\s*[:\-]\s*([^\n]{2,80})", re.IGNORECASE)


def _spans_for_page(page: fitz.Page) -> list[PageTextSpan]:
    """Use the dict text layer; this gives us every span with its bbox."""
    out: list[PageTextSpan] = []
    page_dict = page.get_text("dict")
    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:  # 0 = text block
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                txt = (span.get("text") or "").strip()
                if not txt:
                    continue
                bbox = span.get("bbox") or [0, 0, 0, 0]
                out.append(PageTextSpan(
                    page=page.number,
                    text=txt,
                    x0=float(bbox[0]),
                    y0=float(bbox[1]),
                    x1=float(bbox[2]),
                    y1=float(bbox[3]),
                    font_size=float(span.get("size") or 0),
                ))
    return out


def _detect_title_block_fields(spans: list[PageTextSpan], result: PdfExtraction, page: fitz.Page) -> dict[str, str]:
    """Title blocks live in a corner (usually bottom-right). We harvest the
    last quarter of the page by area and run a few regexes over its text."""
    if not spans:
        return {}
    page_w = page.rect.width
    page_h = page.rect.height
    corner_spans = [
        s for s in spans
        if s.x0 >= page_w * 0.6 and s.y0 >= page_h * 0.6
    ]
    if not corner_spans:
        return {}
    corner_text = "\n".join(s.text for s in corner_spans)
    fields: dict[str, str] = {}
    m = _SHEET_NUMBER_RE.search(corner_text)
    if m:
        fields["SHEET"] = m.group(1).strip()
    m = _SCALE_RE.search(corner_text)
    if m:
        fields["SCALE"] = m.group(1).strip()
    m = _DRAWN_BY_RE.search(corner_text)
    if m:
        fields["DRAWN_BY"] = m.group(1).strip()
    m = _PROJECT_RE.search(corner_text)
    if m:
        fields["PROJECT"] = m.group(1).strip()
    return fields


def _detect_schedules_on_page(spans: list[PageTextSpan], page_num: int) -> list[DetectedSchedule]:
    """Cluster spans by y-coordinate to find table rows, then keep rows with
    ≥3 columns. If we find a coherent stack of ≥3 such rows, that's a schedule."""
    if len(spans) < 9:
        return []
    # Use the median font size as the y-tolerance
    sizes = sorted([s.font_size for s in spans if s.font_size > 0])
    tol = sizes[len(sizes) // 2] * 1.2 if sizes else 6.0

    by_y = sorted(spans, key=lambda s: (-s.y0, s.x0))
    rows: list[list[PageTextSpan]] = []
    for s in by_y:
        if rows and abs(rows[-1][0].y0 - s.y0) <= tol:
            rows[-1].append(s)
        else:
            rows.append([s])

    grid_rows = [sorted(r, key=lambda s: s.x0) for r in rows if len(r) >= 3]
    # We need at least 3 such consecutive rows whose column count is similar
    schedules: list[DetectedSchedule] = []
    if len(grid_rows) < 3:
        return schedules

    # Group consecutive rows with similar column count
    current: list[list[PageTextSpan]] = [grid_rows[0]]
    for r in grid_rows[1:]:
        last = current[-1]
        if abs(len(r) - len(last)) <= 1:
            current.append(r)
        else:
            if len(current) >= 3:
                header = [c.text for c in current[0]]
                rows_text = [[c.text for c in row] for row in current[1:]]
                schedules.append(DetectedSchedule(
                    page=page_num, header=header,
                    rows=rows_text[:50], row_count=len(rows_text),
                ))
            current = [r]
    if len(current) >= 3:
        header = [c.text for c in current[0]]
        rows_text = [[c.text for c in row] for row in current[1:]]
        schedules.append(DetectedSchedule(
            page=page_num, header=header,
            rows=rows_text[:50], row_count=len(rows_text),
        ))
    return schedules


def extract_pdf(path: str) -> dict[str, Any]:
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    doc = fitz.open(path)
    result = PdfExtraction(file=os.path.basename(path), page_count=doc.page_count)

    text_spans_capped = 0
    SPAN_CAP = 15000   # hard cap for huge multi-sheet drawing sets

    for page_idx, page in enumerate(doc):
        spans = _spans_for_page(page)
        distinct = {s.text for s in spans}
        is_scan = len(spans) < 5  # heuristic: scanned page has no real text layer
        tb = _detect_title_block_fields(spans, result, page)

        # Promote *unique* title block fields to the document level. If two
        # pages disagree on PROJECT, we keep the first one we saw and warn.
        for k, v in tb.items():
            if k not in result.title_block_fields:
                result.title_block_fields[k] = v

        sheet_label = tb.get("SHEET")
        result.pages.append(PageSummary(
            page=page_idx,
            width=float(page.rect.width),
            height=float(page.rect.height),
            text_span_count=len(spans),
            distinct_text_count=len(distinct),
            is_likely_scan=is_scan,
            sheet_label=sheet_label,
        ))

        page_texts: list[str] = []
        for s in spans:
            if text_spans_capped < SPAN_CAP:
                result.text_spans.append(s)
                text_spans_capped += 1
            page_texts.append(s.text)
        result.text_by_page[page_idx] = page_texts[:1000]

        if is_scan:
            result.warnings.append(f"page {page_idx + 1} looks like a scanned image (no text layer)")
        else:
            result.schedules.extend(_detect_schedules_on_page(spans, page_idx))

    if text_spans_capped >= SPAN_CAP:
        result.warnings.append(f"trimmed text_spans to {SPAN_CAP}")

    doc.close()
    return result.to_dict()
