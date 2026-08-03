# The CAD extraction sidecar. Stateless by construction: no DB driver, no
# credentials, and the uploads volume is mounted read-only.

# ── LibreDWG gives us .dwg support with no manual download. The ODA File
# Converter has better fidelity but is a free-with-registration binary nobody
# installs, so DWG would be broken by default. This stage builds dwg2dxf; the
# runtime image copies the single static binary and none of the toolchain.
FROM python:3.12-slim AS dwg
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends \
      build-essential autoconf automake libtool pkg-config git ca-certificates texinfo \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/LibreDWG/libredwg.git /src
WORKDIR /src
RUN sh autogen.sh \
 && ./configure --disable-bindings --disable-shared --enable-static \
      --disable-dependency-tracking PYTHON=/usr/local/bin/python3 \
 && make -j4 && make install

FROM python:3.12-slim

WORKDIR /app

COPY --from=dwg /usr/local/bin/dwg2dxf /usr/local/bin/dwg2dxf

# Fonts. python:3.12-slim ships with none at all, and ezdxf's SVG backend
# refuses to draw a sheet that contains a single piece of text without one —
# `FontNotFoundError('no fonts available, not even fallback fonts')`. Every
# construction drawing is covered in text, so with no font installed EVERY
# sheet fails to render while measuring perfectly: the quantities are right and
# the estimator cannot see the drawing they came from. DejaVu is the metric
# fallback ezdxf expects; fontconfig is what lets it be found.
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends fonts-dejavu-core fontconfig \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

# ezdxf builds cleanly on slim; no compiler needed for these pins.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY extractor.py app.py ./

# Non-root: this parses untrusted files from the internet. ezdxf wants a
# writable cache for its font metrics; without a home it warns on every call.
RUN useradd --system --uid 1001 --create-home --home-dir /home/cad cad \
 && mkdir -p /home/cad/.cache/ezdxf && chown -R cad:cad /home/cad
ENV HOME=/home/cad
USER cad

EXPOSE 7400
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7400"]
