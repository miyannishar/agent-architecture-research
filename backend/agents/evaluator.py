import logging
import random

from agents.architectures import ARCHITECTURES, RUNNERS, AgentResult, calls_per_task
from agents.llm import Usage, llm_configured

logger = logging.getLogger(__name__)

DEFAULT_MAX_TOKENS = 1024


def run_agent_test(architecture: str, prompt: str, num_agents: int = 3, rounds: int = 1,
                   max_tokens: int = DEFAULT_MAX_TOKENS) -> AgentResult:
    """Run one task through one architecture. Raises ValueError for unknown architectures
    and propagates LLM errors so the API (and benchmarks) never report a failure as a result."""
    if architecture not in ARCHITECTURES:
        raise ValueError(f"Unknown architecture '{architecture}'. Expected one of {ARCHITECTURES}.")

    if not llm_configured():
        logger.info(f"Using MOCK agent for {architecture} because LLM_API_KEY is not set.")
        return _mock_run(architecture, num_agents, rounds)

    logger.info(f"Running {architecture} (agents={num_agents}, rounds={rounds}, max_tokens={max_tokens})")
    return RUNNERS[architecture](prompt, max_tokens=max_tokens, num_agents=num_agents, rounds=rounds)


def _mock_run(architecture: str, num_agents: int, rounds: int) -> AgentResult:
    """Canned response when no key is configured so the UI still works. Never use for experiments."""
    calls = calls_per_task(architecture, num_agents, rounds)
    tokens = random.randint(100, 300) * calls
    usage = Usage(calls=calls, input_tokens=tokens // 2, output_tokens=tokens - tokens // 2, cost=tokens * 0.000002)
    return AgentResult(
        output=f"Mock response from '{architecture}' ({calls} model calls). LLM_API_KEY not set.",
        final_answer="mock",
        usage=usage,
        trace=["mock"] * num_agents,
    )
