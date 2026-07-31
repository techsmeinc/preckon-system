# The CAD extraction sidecar. Stateless by construction: no DB driver, no
# credentials, and the uploads volume is mounted read-only.
FROM python:3.12-slim

WORKDIR /app

# ezdxf builds cleanly on slim; no compiler needed for these pins.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY extractor.py app.py ./

# Non-root: this parses untrusted files from the internet.
RUN useradd --system --uid 1001 cad
USER cad

EXPOSE 7400
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7400"]
