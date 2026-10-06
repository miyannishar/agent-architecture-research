"""Single LLM entry point so every architecture uses the same model, key and cost accounting."""
import os
import time
import logging
from dataclasses import dataclass, field

import litellm

logger = logging.getLogger(__name__)

# Anthropic via LiteLLM. Override with LLM_MODEL (e.g. "anthropic/claude-sonnet-5-5").
DEFAULT_MODEL = "anthropic/claude-haiku-4-5-20251001"


def llm_configured() -> bool:
    return bool(os.getenv("LLM_API_KEY"))


def model_name() -> str:
    return os.getenv("LLM_MODEL", DEFAULT_MODEL)


def _price_per_token() -> tuple[float, float]:
    """(input, output) USD per token. Defaults are Claude Haiku 4.5 list prices ($1 / $5 per MTok)."""
    inp = float(os.getenv("LLM_INPUT_COST_PER_MTOK", "1.0")) / 1_000_000
    out = float(os.getenv("LLM_OUTPUT_COST_PER_MTOK", "5.0")) / 1_000_000
    return inp, out


@dataclass
class Usage:
    """Accumulated compute for one task: the quantities the research compares across architectures."""
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost: float = 0.0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def add(self, other: "Usage") -> None:
        self.calls += other.calls
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cost += other.cost


@dataclass
class ChatResult:
    text: str
    usage: Usage = field(default_factory=Usage)


def chat(system: str, user: str, temperature: float = 0.0, max_tokens: int = 1024) -> ChatResult:
    """One model call. Raises on failure (callers must not hide errors, or benchmarks get silently skewed)."""
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            response = litellm.completion(
                model=model_name(),
                api_key=os.getenv("LLM_API_KEY"),
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
            )
            break
        except (litellm.RateLimitError, litellm.ServiceUnavailableError, litellm.APIConnectionError) as e:
            last_exc = e
            wait = 2 ** attempt
            logger.warning(f"Transient LLM error ({type(e).__name__}); retrying in {wait}s")
            time.sleep(wait)
    else:
        raise last_exc  # type: ignore[misc]

    u = response.usage
    in_tok = getattr(u, "prompt_tokens", 0) or 0
    out_tok = getattr(u, "completion_tokens", 0) or 0
    in_price, out_price = _price_per_token()
    usage = Usage(calls=1, input_tokens=in_tok, output_tokens=out_tok,
                  cost=in_tok * in_price + out_tok * out_price)
    return ChatResult(text=response.choices[0].message.content or "", usage=usage)
