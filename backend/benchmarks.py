"""Benchmark loaders. Each returns a list of {"id", "prompt", "answer"} with `answer` already normalized.

Only GSM8K is implemented so far; MMLU-Pro and BBH are the next loaders to add (same shape).
"""
import json
import random
import urllib.request
from pathlib import Path

from agents.architectures import normalize_answer

DATA_DIR = Path(__file__).parent / "data"
GSM8K_URL = "https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl"


def load_gsm8k(n: int, seed: int = 0) -> list[dict]:
    """Seeded random subset of the GSM8K test set, so every architecture sees the same questions."""
    path = DATA_DIR / "gsm8k_test.jsonl"
    if not path.exists():
        DATA_DIR.mkdir(exist_ok=True)
        urllib.request.urlretrieve(GSM8K_URL, path)
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    random.Random(seed).shuffle(rows)
    return [
        {
            "id": i,
            "prompt": r["question"],
            "answer": normalize_answer(r["answer"].split("####")[-1].strip()),
        }
        for i, r in enumerate(rows[:n])
    ]


LOADERS = {"gsm8k": load_gsm8k}
