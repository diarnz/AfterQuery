.PHONY: setup api web test check db db-stop

setup:
	uv sync --locked
	npm --prefix web ci

api:
	uv run --locked uvicorn runbook.api.app:app --host 127.0.0.1 --port 8000 --reload

web:
	npm --prefix web run dev

test:
	uv run --locked python -m unittest discover -s tests -v

check: test
	uv run --locked ruff check runbook tests
	npm --prefix web run build
	docker compose config --quiet

db:
	docker compose up -d --wait db

db-stop:
	docker compose stop db
