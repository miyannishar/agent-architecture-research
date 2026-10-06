"""The agent architectures under comparison. All use the same model, prompts style and answer format,
so differences in results come from the architecture, not implementation details.

`num_agents` means: single=1, parallel_voting=N voters, sequential_review=1 solver + (N-1) reviewers,
debate=N debaters (each answers, then revises after seeing the others, `rounds` times).
"""
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from agents.llm import Usage, chat

ARCHITECTURES = ("single_agent", "parallel_voting", "sequential_review", "debate")

SOLVE_SYSTEM = (
    "You are a careful reasoning agent. Think step by step, then finish with a last line of the form "
    "'Final answer: <answer>' containing only the answer (a number for math problems, a single option "
    "letter for multiple choice)."
)
REVIEW_SYSTEM = (
    "You are a reviewer agent. You are given a task and a previous agent's solution. Check each step; "
    "if it is correct keep its answer, if it is wrong fix it. Do not change a correct answer. "
    "Finish with a last line of the form 'Final answer: <answer>'."
)
DEBATE_SYSTEM = (
    "You are one agent in a debate. You are given a task and the other agents' solutions. Critique them, "
    "re-check your own reasoning, and give your best answer. Hold your position if you believe it is correct. "
    "Finish with a last line of the form 'Final answer: <answer>'."
)

_FINAL_RE = re.compile(r"final answer\s*[:\-]\s*(.+)", re.IGNORECASE)


def extract_answer(text: str) -> str:
    """Pull the text after the last 'Final answer:' marker; '' if the model didn't follow the format."""
    matches = _FINAL_RE.findall(text)
    if not matches:
        return ""
    return matches[-1].strip().strip("*$ ").rstrip(".").strip()


def normalize_answer(ans: str) -> str:
    """Canonical form used for voting and benchmark grading ('1,200.0' == '1200')."""
    cleaned = ans.replace(",", "").replace("$", "").replace("%", "").strip()
    try:
        value = float(cleaned.split()[0]) if cleaned else None
    except ValueError:
        value = None
    if value is not None:
        return str(int(value)) if value == int(value) else str(value)
    # Single option letter like "(B)" or "B."
    m = re.fullmatch(r"\(?([A-Ja-j])\)?[.)]?", cleaned)
    return m.group(1).upper() if m else cleaned.lower()


def calls_per_task(architecture: str, num_agents: int, rounds: int = 1) -> int:
    if architecture == "single_agent":
        return 1
    if architecture == "debate":
        return num_agents * (1 + rounds)
    return num_agents  # parallel_voting, sequential_review


@dataclass
class AgentResult:
    output: str                  # full reasoning shown to the user
    final_answer: str            # normalized answer used for grading
    usage: Usage = field(default_factory=Usage)
    # Intermediate answers per agent, e.g. to study "correct answer flipped by later agents".
    trace: list[str] = field(default_factory=list)


def _majority(answers: list[str]) -> str:
    counts = Counter(a for a in answers if a)
    if not counts:
        return ""
    return counts.most_common(1)[0][0]  # ties resolve to the earliest answer (Counter keeps insertion order)


def single_agent(prompt: str, max_tokens: int, **_) -> AgentResult:
    r = chat(SOLVE_SYSTEM, prompt, temperature=0.0, max_tokens=max_tokens)
    ans = normalize_answer(extract_answer(r.text))
    return AgentResult(r.text, ans, r.usage, [ans])


def parallel_voting(prompt: str, max_tokens: int, num_agents: int = 3, **_) -> AgentResult:
    # Independent samples need temperature > 0, otherwise all voters return the same answer.
    with ThreadPoolExecutor(max_workers=num_agents) as pool:
        results = list(pool.map(lambda _i: chat(SOLVE_SYSTEM, prompt, temperature=0.7, max_tokens=max_tokens),
                                range(num_agents)))
    usage = Usage()
    answers = []
    for r in results:
        usage.add(r.usage)
        answers.append(normalize_answer(extract_answer(r.text)))
    winner = _majority(answers)
    chosen = next((r.text for r, a in zip(results, answers) if a == winner), results[0].text)
    output = f"{chosen}\n\n[Votes: {answers} -> {winner or 'no valid answer'}]"
    return AgentResult(output, winner, usage, answers)


def sequential_review(prompt: str, max_tokens: int, num_agents: int = 2, **_) -> AgentResult:
    usage = Usage()
    current = chat(SOLVE_SYSTEM, prompt, temperature=0.0, max_tokens=max_tokens)
    usage.add(current.usage)
    trace = [normalize_answer(extract_answer(current.text))]
    for _i in range(max(num_agents - 1, 0)):
        review_prompt = f"Task:\n{prompt}\n\nPrevious solution:\n{current.text}"
        current = chat(REVIEW_SYSTEM, review_prompt, temperature=0.0, max_tokens=max_tokens)
        usage.add(current.usage)
        trace.append(normalize_answer(extract_answer(current.text)))
    return AgentResult(current.text, trace[-1], usage, trace)


def debate(prompt: str, max_tokens: int, num_agents: int = 3, rounds: int = 1, **_) -> AgentResult:
    usage = Usage()
    with ThreadPoolExecutor(max_workers=num_agents) as pool:
        solutions = list(pool.map(lambda _i: chat(SOLVE_SYSTEM, prompt, temperature=0.7, max_tokens=max_tokens),
                                  range(num_agents)))
        for r in solutions:
            usage.add(r.usage)
        trace = [normalize_answer(extract_answer(r.text)) for r in solutions]

        for _round in range(rounds):
            def revise(i: int):
                others = "\n\n".join(f"Agent {j + 1}:\n{s.text}" for j, s in enumerate(solutions) if j != i)
                return chat(DEBATE_SYSTEM, f"Task:\n{prompt}\n\nYour solution:\n{solutions[i].text}\n\n"
                                           f"Other agents' solutions:\n{others}",
                            temperature=0.7, max_tokens=max_tokens)
            solutions = list(pool.map(revise, range(num_agents)))
            for r in solutions:
                usage.add(r.usage)
            trace = [normalize_answer(extract_answer(r.text)) for r in solutions]

    winner = _majority(trace)
    chosen = next((s.text for s, a in zip(solutions, trace) if a == winner), solutions[0].text)
    output = f"{chosen}\n\n[Final-round answers: {trace} -> {winner or 'no valid answer'}]"
    return AgentResult(output, winner, usage, trace)


RUNNERS = {
    "single_agent": single_agent,
    "parallel_voting": parallel_voting,
    "sequential_review": sequential_review,
    "debate": debate,
}
