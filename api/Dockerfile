FROM python:3.12-slim
RUN pip install --no-cache-dir fastapi uvicorn pandas numpy psycopg2-binary
COPY . ./
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
