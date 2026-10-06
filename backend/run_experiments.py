"""Benchmark every architecture config on the same questions and report the accuracy/cost trade-off.

Examples (from backend/, with LLM_API_KEY set):
  python run_experiments.py --n 50
  python run_experiments.py --n 50 --configs single_agent:1 parallel_voting:3 parallel_voting:5 debate:3
  python run_experiments.py --n 50 --token-budget 3000     # equal-compute experiment

--token-budget caps the *per-task* completion tokens: each call gets budget // calls_per_task, so a
5-agent system gets 1/5 of the room a single agent has. Without it, systems use as much as they need.
"""
import argparse
import csv
import json
import math
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from agents.architectures import calls_per_task  # noqa: E402
from agents.evaluator import run_agent_test  # noqa: E402
from agents.llm import llm_configured, model_name  # noqa: E402
from benchmarks import LOADERS  # noqa: E402

DEFAULT_CONFIGS = [
    "single_agent:1",
    "parallel_voting:3", "parallel_voting:5",
    "sequential_review:2", "sequential_review:3",
    "debate:3",
]
BASELINE = "single_agent:1"
RESULTS_DIR = Path(__file__).parent / "results"


def parse_config(cfg: str) -> tuple[str, int]:
    arch, _, n = cfg.partition(":")
    return arch, int(n or 1)


def run(args) -> list[dict]:
    questions = LOADERS[args.dataset](args.n, args.seed)
    rows = []
    out_path = RESULTS_DIR / f"{args.dataset}_{datetime.now():%Y%m%d_%H%M%S}.jsonl"
    RESULTS_DIR.mkdir(exist_ok=True)
    print(f"Model: {model_name()} | dataset: {args.dataset} | questions: {len(questions)} | out: {out_path}")

    with out_path.open("w") as f:
        for cfg in args.configs:
            arch, n_agents = parse_config(cfg)
            calls = calls_per_task(arch, n_agents, args.rounds)
            max_tokens = max(64, args.token_budget // calls) if args.token_budget else args.max_tokens
            for q in questions:
                row = {"config": cfg, "architecture": arch, "num_agents": n_agents, "qid": q["id"],
                       "gold": q["answer"], "max_tokens_per_call": max_tokens}
                start = time.time()
                try:
                    res = run_agent_test(arch, q["prompt"], num_agents=n_agents, rounds=args.rounds,
                                         max_tokens=max_tokens)
                    row.update(pred=res.final_answer, correct=res.final_answer == q["answer"], trace=res.trace,
                               calls=res.usage.calls, tokens=res.usage.total_tokens, cost=res.usage.cost)
                except Exception as e:  # recorded and excluded from accuracy, never counted as a model answer
                    row.update(error=f"{type(e).__name__}: {e}", correct=None)
                row["latency_s"] = time.time() - start
                f.write(json.dumps(row) + "\n")
                f.flush()
                rows.append(row)
            done = [r for r in rows if r["config"] == cfg and r["correct"] is not None]
            acc = sum(r["correct"] for r in done) / max(len(done), 1)
            print(f"  {cfg:<22} acc={acc:.1%}  ({len(done)}/{len(questions)} ok)")
    return rows


def summarize(rows: list[dict], configs: list[str]) -> list[dict]:
    by_cfg = {c: {r["qid"]: r for r in rows if r["config"] == c} for c in configs}
    base = by_cfg.get(BASELINE, {})
    summary = []
    for cfg in configs:
        ok = [r for r in by_cfg[cfg].values() if r["correct"] is not None]
        if not ok:
            continue
        n = len(ok)
        acc = sum(r["correct"] for r in ok) / n
        mean = lambda k: sum(r[k] for r in ok) / n  # noqa: E731
        s = {
            "config": cfg, "n": n, "errors": len(by_cfg[cfg]) - n,
            "accuracy": acc, "ci95": 1.96 * math.sqrt(acc * (1 - acc) / n),
            "mean_calls": mean("calls"), "mean_tokens": mean("tokens"),
            "mean_latency_s": mean("latency_s"), "mean_cost": mean("cost"),
        }
        # Paired comparison against the single-agent baseline on questions both answered.
        paired = [(base[q], r) for q, r in by_cfg[cfg].items()
                  if q in base and base[q]["correct"] is not None and r["correct"] is not None]
        if cfg != BASELINE and paired:
            b_acc = sum(b["correct"] for b, _ in paired) / len(paired)
            m_acc = sum(r["correct"] for _, r in paired) / len(paired)
            extra_agents = parse_config(cfg)[1] - 1
            extra_tokens = sum(r["tokens"] - b["tokens"] for b, r in paired) / len(paired)
            s.update(
                delta_acc=m_acc - b_acc,
                delta_acc_per_extra_agent=(m_acc - b_acc) / extra_agents if extra_agents else None,
                delta_acc_per_extra_1k_tokens=(m_acc - b_acc) / (extra_tokens / 1000) if extra_tokens > 0 else None,
                # Failure analysis: where collaboration hurt vs. helped relative to the single agent.
                lost=sum(b["correct"] and not r["correct"] for b, r in paired),
                gained=sum(r["correct"] and not b["correct"] for b, r in paired),
            )
        summary.append(s)
    return summary


def print_summary(summary: list[dict]) -> None:
    fmt = lambda v, p="{:.3f}": "-" if v is None else p.format(v)  # noqa: E731
    print(f"\n{'config':<22}{'acc':>7}{'±95%':>7}{'calls':>7}{'tokens':>9}{'lat(s)':>8}{'cost($)':>10}"
          f"{'Δacc':>8}{'Δ/agent':>9}{'Δ/1k tok':>10}{'lost':>6}{'gained':>8}")
    for s in summary:
        print(f"{s['config']:<22}{s['accuracy']:>7.1%}{s['ci95']:>7.1%}{s['mean_calls']:>7.1f}"
              f"{s['mean_tokens']:>9.0f}{s['mean_latency_s']:>8.1f}{s['mean_cost']:>10.5f}"
              f"{fmt(s.get('delta_acc'), '{:+.1%}'):>8}{fmt(s.get('delta_acc_per_extra_agent'), '{:+.2%}'):>9}"
              f"{fmt(s.get('delta_acc_per_extra_1k_tokens'), '{:+.2%}'):>10}"
              f"{fmt(s.get('lost'), '{}'):>6}{fmt(s.get('gained'), '{}'):>8}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dataset", choices=list(LOADERS), default="gsm8k")
    p.add_argument("--n", type=int, default=50, help="questions per config (same questions for all)")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--configs", nargs="+", default=DEFAULT_CONFIGS, help="architecture:num_agents")
    p.add_argument("--rounds", type=int, default=1, help="debate rounds")
    p.add_argument("--max-tokens", type=int, default=1024, help="per-call completion cap (normal condition)")
    p.add_argument("--token-budget", type=int, default=0, help="per-task completion budget (equal-compute mode)")
    args = p.parse_args()

    if not llm_configured():
        raise SystemExit("LLM_API_KEY is not set; refusing to run experiments against the mock agent.")
    if BASELINE not in args.configs:
        args.configs.insert(0, BASELINE)

    rows = run(args)
    summary = summarize(rows, args.configs)
    print_summary(summary)

    stamp = f"{args.dataset}_{datetime.now():%Y%m%d_%H%M%S}"
    (RESULTS_DIR / f"{stamp}_summary.json").write_text(json.dumps(summary, indent=2))
    with (RESULTS_DIR / f"{stamp}_summary.csv").open("w", newline="") as f:
        keys = sorted({k for s in summary for k in s}, key=lambda k: (k != "config", k))
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(summary)


if __name__ == "__main__":
    main()
