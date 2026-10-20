"""Benchmark loaders. Each returns a list of {"id", "prompt", "answer"} with `answer` already normalized.

Only GSM8K is implemented so far; MMLU-Pro and BBH are the next loaders to add (same shape).
"""
import hashlib
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
    rows = [(i, json.loads(line)) for i, line in enumerate(path.read_text().splitlines()) if line.strip()]
    random.Random(seed).shuffle(rows)
    return [
        {
            # Keep the source row index so results can be checked against this exact file.
            "id": source_id,
            "prompt": r["question"],
            "answer": normalize_answer(r["answer"].split("####")[-1].strip()),
        }
        for source_id, r in rows[:n]
    ]


def gsm8k_fingerprint() -> dict:
    """Return the local dataset identity for experiment provenance."""
    path = DATA_DIR / "gsm8k_test.jsonl"
    if not path.exists():
        # Use the same download path as the loader, then fingerprint the exact bytes used.
        load_gsm8k(1, 0)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with path.open() as dataset_file:
        row_count = sum(1 for line in dataset_file if line.strip())
    return {"name": "gsm8k_test", "sha256": digest, "rows": row_count}


LOADERS = {"gsm8k": load_gsm8k}
