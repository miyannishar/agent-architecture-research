# Repository Guidelines

## Project Structure

This repository compares single-agent and multi-agent LLM reasoning architectures. The FastAPI service and experiment tooling live in `backend/`; architecture implementations are in `backend/agents/`. The Next.js dashboard is in `frontend/src/app/`. Its paired GSM8K benchmark endpoint is `POST /api/benchmark/run`; the one-off prompt endpoint remains `POST /api/run-test`. Research proposals and progress reports are in `docs/`. Experiment datasets and generated results belong in the gitignored `backend/data/` and `backend/results/` directories.

## Build, Run, and Development

Run each service from its own directory:

- Backend setup: `cd backend && pip install -r requirements.txt`
- Backend API: `cd backend && uvicorn main:app --reload --port 8000`
- Backend container: `cd backend && docker compose up`
- Frontend development: `cd frontend && npm install && npm run dev`
- Frontend checks: `cd frontend && npm run lint` and `npm run build`
- Benchmarks: from `backend/`, set `LLM_API_KEY` and run `python run_experiments.py --n 50`. Optional `--token-budget 3000` divides a completion-token cap across calls; it does not equalize prompt tokens or total compute.

The dashboard reads `NEXT_PUBLIC_BACKEND_URL`, defaulting to `http://localhost:8000`. Backend environment examples are in `backend/.env.example`; keep real keys in local environment files and never commit them. Without `LLM_API_KEY`, the one-off API uses mock responses; benchmark runs reject mock mode and require `LLM_API_KEY`. The benchmark endpoint is available without an enable flag and can incur provider charges.

## Code Style and Organization

Keep backend Python organized around the existing modules: API concerns in `main.py`, model calls in `agents/llm.py`, architecture behavior in `agents/architectures.py`, evaluation in `agents/evaluator.py`, and dataset loading/experiments in their dedicated modules. Follow existing four-space Python indentation and type-hint patterns. Frontend code uses TypeScript, React function components, and the existing ESLint configuration; use the established formatting and naming in `src/app/` (PascalCase components and camelCase variables). Before changing Next.js APIs, follow the Next.js agent guidance in `frontend/AGENTS.md` and consult the installed Next.js docs.

## Testing and Validation

There is no automated test suite currently. For frontend changes, run `npm run lint` and `npm run build` from `frontend/`. For backend changes, start the API and check `GET /` and `POST /api/run-test`; use real credentials for meaningful model checks. Benchmark runs can incur API cost and write generated files under `backend/results/`.

## Commits and Pull Requests

Recent commits use short imperative/conventional subjects such as `feat: ...`; continue that pattern (for example, `fix: surface backend errors`). Pull requests should explain the behavior or research change, list validation performed, link related issues or reports, and include a screenshot for visible dashboard changes. Keep experiment claims tied to reproducible runs and clearly identify mock data.
