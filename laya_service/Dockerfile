# FraudLens Laya decision service: CPU-only PyTorch + Laya, weights baked in at a reviewed revision.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 \
    HF_HOME=/models USE_TF=0 TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=2 \
    LAYA_MODEL=convaiinnovations/laya-typed-decisions \
    LAYA_REVISION_SHA=1a793eb568e6718f15941d08f85432581df534e3
WORKDIR /srv
COPY requirements.txt .
# CPU wheel index keeps the image free of CUDA libraries (several GB smaller).
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 \
 && pip install --no-cache-dir -r requirements.txt
# Download the pinned checkpoint at build time; the running service never reaches the internet for weights.
RUN python -c "import os, laya; laya.load(os.environ['LAYA_MODEL'], device='cpu', revision=os.environ['LAYA_REVISION_SHA'])" \
 && find /models -type f | head -20
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
COPY app.py .
RUN useradd --create-home --uid 10001 laya && chown -R laya /srv /models
USER laya
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1"]
