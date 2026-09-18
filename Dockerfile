FROM node:22-bookworm-slim AS webbuild

WORKDIR /frontend
RUN npm install -g yarn@1.22.22

COPY frontend/package.json frontend/yarn.lock ./
COPY frontend/scripts ./scripts
RUN yarn install --frozen-lockfile

COPY frontend/ ./
RUN npx expo export --platform web


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=webbuild /frontend/dist ./frontend_dist

EXPOSE 8000

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
