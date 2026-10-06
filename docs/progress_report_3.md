# Progress Report 3: Week 7

## 1. Work Completed
Week 7 moved the project from infrastructure to the research itself. The stub architectures from Weeks 1–6 are replaced with working implementations, and an automated benchmark pipeline now exists to run the experiments described in the research plan.

1. **Switch from OpenAI to Anthropic (`LLM_API_KEY`)**
   - The team moved from OpenAI (`gpt-3.5-turbo`, `OPENAI_API_KEY`) to Anthropic Claude for better reasoning performance.
   - The single environment variable is now **`LLM_API_KEY`**, which holds the Anthropic API key. It is provider-neutral on purpose: moving models again needs no rename in Docker, Railway or code.
   - The default model is `anthropic/claude-haiku-4-5-20251001`, routed through LiteLLM. Override it with `LLM_MODEL`.
   - Cost is now computed from separate input and output token counts, with Claude Haiku 4.5 list prices as defaults (`LLM_INPUT_COST_PER_MTOK=1`, `LLM_OUTPUT_COST_PER_MTOK=5`). This replaces the flat `tokens × $0.000002` estimate. Prices are configurable, so update them if the model changes.
   - Updated `backend/.env.example` and `backend/docker-compose.yml`. **Action for deployment: set `LLM_API_KEY` (and optionally `LLM_MODEL`) in Railway and remove `OPENAI_API_KEY`.**
2. **All planned architectures implemented** (`backend/agents/architectures.py`). All use the same model, the same prompt style and the same `Final answer:` output format, so differences come from the architecture alone:
   - **Single agent** (baseline): one call at temperature 0.
   - **Parallel voting**: N independent agents (temperature 0.7) with a majority vote on the extracted answer.
   - **Sequential review**: one solver followed by N−1 reviewers, each told to fix errors but not change a correct answer.
   - **Multi-agent debate**: N agents solve independently, then revise after reading the others' solutions for a configurable number of rounds, and the final answer is a majority vote.
   - The agent count N is a parameter, which supports the planned 1 / 2 / 3 / 5 agent sweep.
3. **Compute accounting.** Every task now reports model calls, input/output tokens and cost, aggregated across all agents. These are the quantities the research compares.
4. **Automated benchmark pipeline** (`backend/benchmarks.py`, `backend/run_experiments.py`):
   - Loads a seeded random subset of the **GSM8K** test set, so every architecture gets the same questions.
   - Runs every architecture/agent-count config and logs one JSON row per question (prediction, correctness, per-agent answers, calls, tokens, cost, latency).
   - Prints and saves a summary with accuracy and 95% confidence interval, mean calls, tokens, latency and cost, plus accuracy gain over the baseline **per extra agent** and **per extra 1k tokens**.
   - **Failure analysis:** for each config, the number of questions the single agent got right that the multi-agent system got wrong ("lost") and vice versa ("gained"). This addresses the research question on whether collaboration can degrade a correct answer.
   - **Equal-compute mode** (`--token-budget N`): caps each task's completion tokens and divides them across the architecture's calls, so a 5-agent system gets 1/5 of a single agent's room per call. Without the flag, systems use what they need, which gives the "normal conditions" experiment.
5. **Dashboard and API**: the API accepts `num_agents` and the `debate` architecture and returns the final answer and call count. The UI gained a debate option, an agent-count selector, and displays model calls and final answer. Fixed the lint errors in `page.tsx` (typed result instead of `any`).
6. **Error handling fix**: LLM failures used to be returned as a normal 200 response containing "Error executing agent…" with 0 tokens. They now propagate as HTTP 500 (unknown architecture gives 400). This matters for benchmarking, because a failure can no longer be silently graded as a wrong answer. The experiment runner records errors separately and excludes them from accuracy.

## 2. Methods and Approaches
- **Controlled comparison**: one model, one answer format and one question set across all architectures. Voting and debate use temperature 0.7 because independent samples at temperature 0 would be identical, while the single agent and reviewers use 0.
- **Two experiment types from the research plan**: normal conditions (multi-agent systems may use extra compute) and an approximately equal token budget (isolates collaboration from simply spending more compute).
- **Grading**: deterministic. GSM8K answers are normalized numerically (`1,200.0` equals `1200`). Option-letter normalization is in place for the multiple-choice datasets planned next.

## 3. Results and Outcomes
- The multi-agent architectures, cost accounting, benchmark runner and UI are implemented and working end to end.
- **Verification so far:** architecture logic, voting, answer parsing, GSM8K loading, summary statistics and the API endpoint were exercised with a stubbed model. Frontend lint passes.
- **No empirical results yet.** The first real benchmark runs against the Anthropic API are the immediate next step. No accuracy or cost figures are reported here, because none have been measured.

## 4. Challenges Encountered
1. **Comparing fairly**: multi-agent systems can look better just because they use more compute. The equal-budget mode is the response, but a token cap can truncate reasoning and lower accuracy at small budgets. That effect is part of what is being measured, and the budget must be chosen so a single agent is not itself truncated.
2. **Answer extraction**: voting and grading depend on the model ending with `Final answer: …`. Responses that miss the format count as no answer. We will track how often this happens, since it can bias the comparison.
3. **Framework deviation**: the proposal named Google ADK. Following the Week 1–4 decision, the architectures use LiteLLM directly, and `google-adk` is still listed in `requirements.txt` but unused.

## 5. Plans for the Next Stage
1. Set `LLM_API_KEY` on Railway and run the first real GSM8K experiments (start with ~50 questions to estimate cost, then scale up).
2. Run both experiments: normal conditions and equal token budget. Sweep 1, 2, 3 and 5 agents.
3. Add MMLU-Pro and BIG-Bench Hard loaders (same question format) and break results down by task difficulty.
4. Review failure cases where the multi-agent answer was wrong and the single agent was right (agents reinforcing a wrong majority, or changing a correct answer).
5. Produce comparison tables and graphs (accuracy vs. cost, tokens, latency and number of agents).
6. If time permits, add the coordinator-worker architecture. Restrict CORS to the Vercel domain.
