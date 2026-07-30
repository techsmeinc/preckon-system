# cad-extractor

Python sidecar service that parses AutoCAD `.dxf` (and `.dwg` via ODA File
Converter) and emits a BOQ-oriented JSON summary used by the Node API for
hybrid RAG + agentic BOQ generation.

## Run

```bash
cd services/cad-extractor
python -m venv .venv
.venv\Scripts\activate            # PowerShell on Windows
# source .venv/bin/activate       # POSIX
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 7400
```

The Node API reads `CAD_EXTRACTOR_URL` (default `http://127.0.0.1:7400`) to
locate this service.

## DWG support

DWG is binary and proprietary. ezdxf can convert via the **ODA File Converter**
(free download from opendesign.com). After installing, either put it on PATH
or set `EZDXF_ODAFC=C:\path\to\ODAFileConverter.exe`. If neither is
available, uploads of `.dwg` files will fail with a clear error and the user
must export to `.dxf` from AutoCAD.

## Output shape

```jsonc
{
  "file": "L02-MEP.dxf",
  "dxfVersion": "AC1032",
  "units": "mm",
  "sheets": ["MODEL", "L02-POWER", "L02-LIGHTING"],
  "layers": [
    {
      "layer": "E-LIGHT-FIX",
      "lineCount": 0, "lineLengthTotal": 0,
      "polylineCount": 12, "polylineLengthTotal": 84.3,
      "circleCount": 0, "arcCount": 0, "hatchCount": 0,
      "insertCount": 142, "textCount": 18, "dimCount": 0, "otherCount": 0
    }
  ],
  "blockDefinitions": ["DOOR_FD60", "LIGHT_2x2_LED", ...],
  "blockInstanceCounts": {
    "LIGHT_2x2_LED": {
      "total": 142,
      "byLayer": {"E-LIGHT-FIX": 142},
      "sheets": ["L02-LIGHTING"],
      "sampleAttributes": {"TAG": "L1", "WATTAGE": "36W"}
    }
  },
  "blockInstances": [ ... ],            // raw per-instance, capped at 5000
  "textAnnotations": [ ... ],           // capped at 5000
  "dimensions": [ ... ],                // capped at 5000
  "titleBlockFields": {"PROJECT": "Tower B", "DRAWN_BY": "AB", ...},
  "schedules": [
    { "layer": "A-ANNO-SCHED", "header": ["TAG","TYPE","WIDTH","HEIGHT"],
      "rows": [["D01","FD60","900","2100"], ...] }
  ],
  "warnings": [ ... ]
}
```
