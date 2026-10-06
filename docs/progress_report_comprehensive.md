# Comprehensive Progress Report: Weeks 1–7

**Project:** Single-Agent vs. Multi-Agent LLM Systems: Evaluating Agentic Architectures for Reasoning Performance and Computational Efficiency
**Repository:** https://github.com/miyannishar/agent-architecture-research

This report compiles the earlier reports (Weeks 1–4: `progress_report_1.md`; Weeks 5–6: `progress_report_2.md`) with the Week 7 update (`progress_report_3.md`).

## 1. Research Goal
Multi-agent LLM architectures are often claimed to improve reasoning, but they also increase model calls, tokens, latency and cost. The primary question:

> Under comparable computational budgets, when do multi-agent LLM systems outperform single-agent systems, and when does adding more agents lead to diminishing or negative returns?

Related questions: does accuracy keep improving with more agents; which architectures work best; do harder tasks benefit more; what does each accuracy gain cost; and can collaboration make a correct answer wrong?

The plan compares a single-agent baseline against parallel voting, sequential review and debate (coordinator-worker if time permits) on GSM8K, MMLU-Pro and BBH. It uses 1, 2, 3 and 5 agents, two conditions (normal and equal compute budget), and reports accuracy, tokens, model calls, latency, cost, accuracy gain per added agent and per added token, and failure cases.

## 2. Timeline Summary

| Weeks | Focus | Outcome |
|---|---|---|
| 1–4 | Proposal, architecture, infrastructure | Research topic and detailed plan defined. Decoupled system built: FastAPI backend (Docker) plus Next.js dashboard. Single-agent baseline working via LiteLLM; multi-agent architectures stubbed. |
| 5–6 | Deployment and benchmark selection | Frontend deployed on Vercel and backend on Railway, both with CI/CD from GitHub. GSM8K and MMLU-Pro chosen as primary datasets. |
| 7 | Core research implementation, provider switch | All four architectures implemented, benchmark and experiment runner built, GSM8K loader, equal-compute mode, failure analysis. Switched to Anthropic via `LLM_API_KEY`. |

## 3. Weeks 1–4: Foundation
- **Research definition:** proposal and detailed plan (`docs/a1.pdf`, `docs/a2.pdf`) set the research question, architectures, datasets, two experiment types, metrics and deliverables.
- **System design:** a decoupled microservice architecture. The Next.js frontend only handles interaction and display, and the FastAPI backend handles all agent orchestration. New topologies need only a new API flag. The backend is containerized for a PaaS, the frontend for edge delivery.
- **Implementation:** FastAPI `/api/run-test` endpoint, Docker/docker-compose setup, and a dashboard to choose an architecture, enter a prompt and view latency, tokens and cost. Python logging traces each request. Mock responses keep the UI usable without an API key.
- **Challenge and decision:** Google ADK failed at runtime (`BaseNode.run() takes 1 positional argument but 2 were given`) and needs heavy session/runner scaffolding. We switched to calling `litellm.completion` directly. It gives the same reasoning behavior with exact token and cost tracking and less overhead. This is a deliberate departure from the proposal, which named ADK as the framework.

## 4. Weeks 5–6: Deployment and Benchmark Research
- **Deployment:** frontend on Vercel, backend on Railway from the Docker configuration, both auto-deployed from GitHub. The frontend reaches the backend through `NEXT_PUBLIC_BACKEND_URL`.
- **Benchmark selection:** GSM8K (objective numeric grading, good for step-by-step reasoning) and MMLU-Pro (multidisciplinary reasoning).
- **Challenge:** routing the Vercel frontend to the Railway backend instead of `localhost`, and injecting API keys in production. The backend currently allows all origins (`allow_origins=["*"]`); restricting it to the Vercel domain is still open.

## 5. Week 7: Core Experiment Infrastructure and Provider Switch

### 5.1 Provider change: OpenAI to Anthropic
The team moved from OpenAI (`gpt-3.5-turbo`, `OPENAI_API_KEY`) to Anthropic Claude for better performance. The key now lives in the provider-neutral **`LLM_API_KEY`** variable (an Anthropic key). The default model is `anthropic/claude-haiku-4-5-20251001` via LiteLLM, overridable with `LLM_MODEL`. Cost is now computed from input and output tokens at configurable per-million-token prices (defaults: Haiku 4.5 at $1 input and $5 output). The deployment environment (Railway) must be updated to set `LLM_API_KEY`.

### 5.2 Architectures implemented
| Architecture | Behavior | Calls per task |
|---|---|---|
| Single agent | One call at temperature 0 (baseline) | 1 |
| Parallel voting | N independent samples (temp 0.7), majority vote | N |
| Sequential review | Solver, then N−1 reviewers that fix errors but keep correct answers | N |
| Debate | N agents solve, then revise after reading the others' solutions, majority vote | N × (1 + rounds) |

### 5.3 Experiment pipeline
`backend/run_experiments.py` runs every config on the same seeded GSM8K subset and reports accuracy (with 95% CI), calls, tokens, latency, cost, accuracy gain over baseline per extra agent and per extra 1k tokens, and counts of questions lost or gained relative to the single agent. `--token-budget` runs the equal-compute experiment by dividing a fixed per-task token budget across an architecture's calls.

### 5.4 Other changes
- LLM failures now return HTTP 500 instead of a normal response containing an error string, so benchmark results can't hide failures.
- The dashboard supports the debate architecture and agent counts, and shows model calls and the final answer.

## 6. Current Status

| Plan item | Status |
|---|---|
| Single-agent baseline | Done |
| Parallel voting, sequential review, debate | Implemented (Week 7); verified with a stubbed model, not yet with real API runs |
| Coordinator-worker | Not started (optional) |
| Agent-count sweep (1/2/3/5) | Supported by the pipeline; not yet run |
| GSM8K | Loader and grading done; no real run yet |
| MMLU-Pro, BBH | Planned |
| Normal and equal-budget experiments | Pipeline done; not yet run |
| Failure-case analysis | Metric implemented; case review pending |
| Graphs and final report | Pending |
| Deployment | Live; `LLM_API_KEY` must be set on Railway |

**No empirical results have been collected yet.** Accuracy and cost comparisons will be reported once the first real runs complete.

## 7. Remaining Work
1. Set `LLM_API_KEY` in production and run a small pilot (~50 GSM8K questions) to estimate cost.
2. Run the full normal-condition and equal-budget experiments across 1, 2, 3 and 5 agents.
3. Add MMLU-Pro and BBH loaders and break results down by task difficulty.
4. Analyze failure cases, produce tables and graphs, and write the final report.
5. Optional: coordinator-worker architecture; restrict CORS.

## 8. Risks and Limitations
- A token cap in the equal-budget experiment can truncate reasoning at small budgets, so the budget must be chosen carefully.
- Voting and grading depend on the model following the `Final answer:` format. The rate of missing answers must be reported.
- Results come from one model family (Claude Haiku 4.5), so conclusions may not generalize to other models.
- The research uses LiteLLM rather than Google ADK as the experimental framework, a deviation from the original proposal.
