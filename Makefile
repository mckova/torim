.PHONY: install dev-api dev-client dev-provider seed test build up

install:
	python3 -m venv .venv && .venv/bin/pip install -r backend/requirements-dev.txt
	npm install

seed:
	cd backend && ../.venv/bin/python -m torim.seed

dev-api:
	cd backend && TORIM_SEED=1 ../.venv/bin/uvicorn torim.main:app --reload --port 8000

dev-client:
	npm run dev:client

dev-provider:
	npm run dev:provider

test:
	cd backend && ../.venv/bin/pytest -q
	npm run typecheck

build:
	npm run build

up:
	docker compose up --build
