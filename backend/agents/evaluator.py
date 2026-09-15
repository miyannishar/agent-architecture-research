import os
import random
import litellm
import logging

# Configure logger
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

def run_agent_test(architecture: str, prompt: str):
    """
    Executes the task using the specified agent architecture.
    Returns: (output_string, token_usage, cost_estimate)
    """
    
    # If API keys are missing, we use a fallback mock response
    if not os.getenv("OPENAI_API_KEY"):
        logger.info(f"Using MOCK agent for {architecture} because OPENAI_API_KEY is not set.")
        return _mock_run(architecture, prompt)
    
    logger.info(f"Using REAL agent with litellm for architecture: {architecture}")
    # We will use LiteLLM directly for a very simple agentic execution structure
    # This bypasses the complex ADK Session/Runner boilerplate while retaining the same reasoning core.
    model_name = "gpt-3.5-turbo" 
    
    try:
        if architecture == "single_agent":
            # Simple Single-Agent Baseline
            response = litellm.completion(
                model=model_name,
                messages=[
                    {"role": "system", "content": "You are a helpful reasoning agent. Solve the following task."},
                    {"role": "user", "content": prompt}
                ]
            )
            text_output = response.choices[0].message.content
            
            # LiteLLM provides exact usage
            tokens = response.usage.total_tokens if response.usage else 0
            
            # Estimate cost (e.g., $0.002 / 1k tokens for 3.5 turbo)
            cost = tokens * 0.000002
            
            return text_output, tokens, cost
            
        elif architecture == "parallel_voting":
            return "Parallel Voting output (Stub).", 1500, 0.003
        elif architecture == "sequential_review":
            return "Sequential Review output (Stub).", 2000, 0.004
        else:
            return "Unknown architecture.", 0, 0.0
            
    except Exception as e:
        return f"Error executing agent: {str(e)}", 0, 0.0

def _mock_run(architecture: str, prompt: str):
    """Mock execution when API keys are unavailable."""
    if architecture == "single_agent":
        tokens = random.randint(100, 300)
        return "This is a mock response from the Single Agent. OpenAI key not found.", tokens, tokens * 0.000002
    elif architecture == "parallel_voting":
        tokens = random.randint(400, 900)
        return "This is a mock response from the Parallel Voting architecture (3 agents).", tokens, tokens * 0.000002
    elif architecture == "sequential_review":
        tokens = random.randint(300, 600)
        return "This is a mock response from the Sequential Review architecture (2 agents).", tokens, tokens * 0.000002
    
    return "Mock fallback", 0, 0.0
