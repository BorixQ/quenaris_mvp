FROM python:3.12-slim-trixie@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt && pip check
RUN useradd --uid 10001 --create-home app && mkdir -p /app/media /app/staticfiles \
    && chown -R app:app /app
COPY --chown=app:app . .
USER app
EXPOSE 8000

FROM runtime AS test
USER root
COPY requirements-test.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements-test.txt && pip check
USER app
