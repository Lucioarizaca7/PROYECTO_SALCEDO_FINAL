# Microservicio analítico (FastAPI). Solo es accesible dentro de la red interna de Docker.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

USER nobody
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/api/health').status == 200 else 1)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
