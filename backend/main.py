from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from typing import Literal
from datetime import datetime, timezone
from pathlib import Path
import json
import math
import os
import time
import uuid
from dotenv import load_dotenv
import logging

# Configure robust logging for backend
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Load environment variables (LLM_API_KEY, LLM_MODEL)
load_dotenv()

from agents.architectures import calls_per_task
from agents.evaluator import run_agent_test
from agents.llm import llm_configured, model_name
from benchmarks import LOADERS, gsm8k_fingerprint

app = FastAPI(title="Agent Architecture Research API")

# Allow CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For production, restrict this to the Vercel domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TestRequest(BaseModel):
    architecture: str # "single_agent", "parallel_voting", "sequential_review", "debate"
    task_prompt: str
    num_agents: int = Field(default=3, ge=1, le=8)
    rounds: int = Field(default=1, ge=1, le=3)  # debate rounds only

class TestResult(BaseModel):
    architecture: str
    result: str
    final_answer: str
    num_agents: int
    num_calls: int
    latency_ms: float
    token_usage: int
    cost_estimate: float


class BenchmarkConfig(BaseModel):
    architecture: Literal["parallel_voting", "sequential_review", "debate"]
    num_agents: int = Field(default=3, ge=2, le=5)
    rounds: int = Field(default=1, ge=1, le=3)


class BenchmarkRequest(BaseModel):
    n: int = Field(default=5, ge=1, le=50)
    seed: int = Field(default=0, ge=0, le=1_000_000)
    mode: Literal["normal", "output_cap"] = "normal"
    max_tokens: int = Field(default=1024, ge=64, le=4096)
    output_budget: int = Field(default=3000, ge=64, le=100_000)
    configs: list[BenchmarkConfig] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_run_size(self):
        selected = [(c.architecture, c.num_agents) for c in self.configs]
        if len(selected) != len(set(selected)):
            raise ValueError("Choose each architecture and agent count only once per run.")
        calls = calls_per_task("single_agent", 1, 1) + sum(
            calls_per_task(c.architecture, c.num_agents, c.rounds) for c in self.configs
        )
        total_calls = self.n * calls
        if total_calls > 120:
            raise ValueError(f"This run would make {total_calls} model calls; the dashboard limit is 120.")
        if self.mode == "output_cap":
            if any(self.output_budget < calls_per_task(c.architecture, c.num_agents, c.rounds) * 64
                   for c in self.configs) or self.output_budget < 64:
                raise ValueError("Output cap must allow at least 64 completion tokens per model call.")
        return self


RESULTS_DIR = Path(__file__).parent / "results"


def _benchmark_summary(rows: list[dict], baseline_rows: list[dict], config: dict) -> dict:
    completed = [r for r in rows if r["correct"] is not None]
    n = len(completed)
    correct_count = sum(r["correct"] for r in completed)
    accuracy = correct_count / n if n else None
    if n:
        z = 1.96
        denominator = 1 + z * z / n
        center = (accuracy + z * z / (2 * n)) / denominator
        margin = z * math.sqrt(accuracy * (1 - accuracy) / n + z * z / (4 * n * n)) / denominator
        ci95_low, ci95_high = max(0.0, center - margin), min(1.0, center + margin)
    else:
        ci95_low, ci95_high = None, None
    baseline_by_id = {r["qid"]: r for r in baseline_rows
                      if r["config"] == "single_agent:1" and r["correct"] is not None}
    paired = [(baseline_by_id[r["qid"]], r) for r in rows
              if r["config"] == config["name"] and r["correct"] is not None
              and r["qid"] in baseline_by_id]
    summary = {
        **config,
        "n_answered": n,
        "errors": len(rows) - n,
        "accuracy": accuracy,
        "ci95_low": ci95_low,
        "ci95_high": ci95_high,
        "mean_calls": sum(r.get("calls", 0) for r in completed) / n if n else None,
        "mean_tokens": sum(r.get("tokens", 0) for r in completed) / n if n else None,
        "mean_input_tokens": sum(r.get("input_tokens", 0) for r in completed) / n if n else None,
        "mean_output_tokens": sum(r.get("output_tokens", 0) for r in completed) / n if n else None,
        "mean_latency_s": sum(r["latency_s"] for r in completed) / n if n else None,
        "mean_cost": sum(r.get("cost", 0) for r in completed) / n if n else None,
    }
    if config["name"] != "single_agent:1":
        summary.update({
            "paired_n": len(paired),
            "gained": sum(not base["correct"] and result["correct"] for base, result in paired),
            "lost": sum(base["correct"] and not result["correct"] for base, result in paired),
            "paired_delta_accuracy": (
                sum(result["correct"] for _, result in paired) / len(paired)
                - sum(base["correct"] for base, _ in paired) / len(paired)
            ) if paired else None,
        })
    return summary

@app.get("/")
def health_check():
    logger.info("Health check endpoint hit.")
    return {"status": "ok", "message": "Backend is running!"}

@app.post("/api/run-test", response_model=TestResult)
def run_test(request: TestRequest):
    logger.info(f"Received test request - Architecture: {request.architecture}")
    logger.info(f"Prompt (preview): {request.task_prompt[:50]}...")
    
    try:
        # Measure time
        start_time = time.time()
        
        # Run the selected agent architecture.
        agent_result = run_agent_test(request.architecture, request.task_prompt,
                                      num_agents=request.num_agents, rounds=request.rounds)
        usage = agent_result.usage
        
        end_time = time.time()
        latency = (end_time - start_time) * 1000
        
        logger.info(f"Test completed successfully - Latency: {latency:.2f}ms | Calls: {usage.calls} | Tokens: {usage.total_tokens} | Cost: ${usage.cost:.6f}")
        
        return TestResult(
            architecture=request.architecture,
            result=agent_result.output,
            final_answer=agent_result.final_answer,
            num_agents=request.num_agents,
            num_calls=usage.calls,
            latency_ms=latency,
            token_usage=usage.total_tokens,
            cost_estimate=usage.cost
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to execute agent test: {str(e)}", exc_info=True)
        # Pass the exact error back to the frontend so the user can see it in the UI
        raise HTTPException(status_code=500, detail=f"Agent Execution Failed: {str(e)}")


@app.post("/api/benchmark/run")
def run_benchmark(request: BenchmarkRequest):
    """Run a paired GSM8K benchmark and persist row-level results with provenance."""
    enabled = os.getenv("ENABLE_BENCHMARK_RUNS", "false").strip().lower() in {"1", "true", "yes"}
    if not enabled:
        raise HTTPException(status_code=503, detail="Benchmark runs are disabled. Set ENABLE_BENCHMARK_RUNS=true to enable them.")
    if not llm_configured():
        raise HTTPException(status_code=503, detail="Set LLM_API_KEY to run real benchmark experiments; mock mode is disabled here.")

    configs = [{"name": "single_agent:1", "architecture": "single_agent", "num_agents": 1, "rounds": 1}]
    configs.extend({"name": f"{c.architecture}:{c.num_agents}", "architecture": c.architecture,
                    "num_agents": c.num_agents, "rounds": c.rounds} for c in request.configs)
    try:
        questions = LOADERS["gsm8k"](request.n, request.seed)
        dataset = gsm8k_fingerprint()
    except Exception as e:
        logger.exception("Unable to load GSM8K for benchmark")
        raise HTTPException(status_code=503, detail=f"GSM8K dataset could not be loaded: {e}") from e

    run_id = f"gsm8k-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    created_at = datetime.now(timezone.utc).isoformat()
    metadata = {
        "run_id": run_id, "created_at": created_at, "dataset": dataset,
        "seed": request.seed, "questions": len(questions), "model": model_name(),
        "mode": request.mode,
        "normal_max_tokens_per_call": request.max_tokens if request.mode == "normal" else None,
        "output_budget": request.output_budget if request.mode == "output_cap" else None,
        "configs": configs,
    }
    RESULTS_DIR.mkdir(exist_ok=True)
    output_path = RESULTS_DIR / f"{run_id}.jsonl"
    all_rows: list[dict] = []

    with output_path.open("w") as output_file:
        for config in configs:
            config_rows = []
            call_count = calls_per_task(config["architecture"], config["num_agents"], config["rounds"])
            max_tokens = (request.output_budget // call_count if request.mode == "output_cap"
                          else request.max_tokens)
            for question in questions:
                row = {
                    "run_id": run_id, "dataset_sha256": dataset["sha256"], "seed": request.seed,
                    "config": config["name"], "architecture": config["architecture"],
                    "num_agents": config["num_agents"], "rounds": config["rounds"],
                    "qid": question["id"], "prompt": question["prompt"], "gold": question["answer"],
                    "max_tokens_per_call": max_tokens,
                }
                started = time.time()
                try:
                    result = run_agent_test(config["architecture"], question["prompt"],
                                            num_agents=config["num_agents"], rounds=config["rounds"],
                                            max_tokens=max_tokens)
                    row.update(pred=result.final_answer, correct=result.final_answer == question["answer"],
                               calls=result.usage.calls, input_tokens=result.usage.input_tokens,
                               output_tokens=result.usage.output_tokens, tokens=result.usage.total_tokens,
                               cost=result.usage.cost, trace=result.trace)
                except Exception as e:
                    row.update(error=f"{type(e).__name__}: {e}", correct=None)
                    logger.exception("Benchmark item failed (%s, qid=%s)", config["name"], question["id"])
                row["latency_s"] = time.time() - started
                config_rows.append(row)
                all_rows.append(row)
                output_file.write(json.dumps(row) + "\n")
                output_file.flush()
            baseline_rows = [r for r in all_rows if r["config"] == "single_agent:1"]
            config["summary"] = _benchmark_summary(config_rows, baseline_rows, config)

    summaries = [c.pop("summary") for c in configs]
    response = {
        **metadata,
        "planned_model_calls": sum(calls_per_task(c["architecture"], c["num_agents"], c["rounds"])
                                   for c in configs) * len(questions),
        "results_file": output_path.name,
        "summaries": summaries,
        "cases": [{k: row.get(k) for k in ("config", "qid", "prompt", "gold", "pred", "correct", "error", "trace")}
                  for row in all_rows],
    }
    (RESULTS_DIR / f"{run_id}.json").write_text(json.dumps(response, indent=2))
    return response
