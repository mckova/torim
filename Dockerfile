# Build both front-ends, then serve them and the API from one Python image.
FROM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps ./apps
RUN npm ci && npm run build

FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt backend/
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend ./backend
COPY --from=web /src/apps/client/dist ./apps/client/dist
COPY --from=web /src/apps/provider/dist ./apps/provider/dist
ENV TORIM_DATABASE_URL=sqlite:////data/torim.db \
    TORIM_SEED=1
VOLUME /data
WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "torim.main:app", "--host", "0.0.0.0", "--port", "8000"]
