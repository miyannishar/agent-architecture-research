# Progress Report 1

## Project Overview
The main goal of this project is to evaluate the reasoning performance and computational efficiency of single-agent versus multi-agent Large Language Model (LLM) architectures. By measuring reasoning accuracy against computational cost (token usage and latency) under comparable budgets, we aim to determine when adding more agents yields diminishing or negative returns. The project initially targeted the Google Agent Development Kit (ADK) wrapped with `litellm` for evaluating models.

## Work Completed
For the first milestone, we successfully designed and implemented the foundational infrastructure required to run controlled experiments:
1. **Decoupled Architecture**: Set up a microservice architecture to support flexible deployments.
   - **Backend**: Built a Python FastAPI application containerized via Docker (`docker-compose`). It exposes endpoints to trigger agent reasoning evaluations.
   - **Frontend**: Scaffolded a Next.js (React) application optimized for Vercel deployment. It provides a clean Dashboard UI to select an architecture (Single Agent, Parallel Voting, Sequential Review) and input a test prompt.
2. **Execution Engine Integration**: Initialized the agent execution pipeline inside the backend (`backend/agents/evaluator.py`). We integrated `litellm` directly to route requests dynamically to OpenAI models (`gpt-3.5-turbo` for testing) using the `OPENAI_API_KEY`. Added robust Python logging to track whether mock or real endpoints are being hit.
3. **Mocking & Fallbacks**: Configured execution stubs for multi-agent architectures (Parallel Voting, Sequential Review) while the core single-agent baseline is fully operational. Added error handling and mock responses to ensure the frontend UI functions fully even if API keys are temporarily unavailable.

## Evidence of Progress
- **GitHub Link**: *(Insert GitHub Repository Link Here)*
- **Code Examples**:
  - The decoupled backend setup using FastAPI is complete. You can review the API routes in [`backend/main.py`](../backend/main.py) and the `docker-compose.yml` configuration.
  - The agent execution logic is located in [`backend/agents/evaluator.py`](../backend/agents/evaluator.py), which uses `litellm.completion` to abstract the underlying model API and accurately track token cost.
  - The frontend dashboard logic and UI components can be found in [`frontend/src/app/page.tsx`](../frontend/src/app/page.tsx).
- **Screenshots**: *(Once deployed or run locally, insert screenshots of the Next.js dashboard UI displaying latency, tokens, and cost estimates here).*

## Challenges
1. **ADK Execution Complexity**: During the implementation of the Google ADK baseline, we encountered a runtime execution barrier (`BaseNode.run() takes 1 positional argument but 2 were given`). Upon investigating the ADK documentation, we discovered that ADK requires a heavy orchestration boilerplate (e.g., `SessionService`, `InMemoryRunner`) for state management that was overly complex for our simple reasoning benchmarks.
   - *Resolution*: To unblock the milestone and prioritize reasoning tests over framework scaffolding, we implemented a direct fallback to `litellm.completion`. This achieves the exact same reasoning logic, securely uses our OpenAI keys, tracks exact token counts and costs, and fulfills the core requirement for the single-agent baseline without the ADK overhead.
2. **Deployment Strategy**: Setting up the project to be easily accessible for running custom tests required rethinking the standard monolithic approach.
   - *Resolution*: We decided to split the repository into a `frontend/` (Next.js on Vercel) and `backend/` (FastAPI with Docker for Render/Railway). We added `.env.local` to securely route frontend API calls to the backend container.

## Next Steps: Deployment Roadmap & Milestones
For the immediate next phase of the project, we will focus on transitioning from a local development environment to a live, publicly accessible evaluation platform. The precise roadmap is as follows:

### 1. Backend Deployment (Railway)
The backend is fully containerized with a `Dockerfile`, making it ready for a PaaS like Railway.
- **Action**: Link the GitHub repository to Railway and create a new project.
- **Configuration**: Railway will automatically detect the `Dockerfile` in the `backend/` directory. We will configure the root directory to `backend/` in the Railway dashboard.
- **Environment**: Inject the `OPENAI_API_KEY` securely into the Railway environment variables.
- **Goal**: Expose the `/api/run-test` endpoint via a live HTTPS URL (e.g., `https://adk-backend.up.railway.app`).

### 2. Frontend Deployment (Vercel)
Vercel offers native, zero-configuration support for Next.js applications.
- **Action**: Import the GitHub repository into a new Vercel project.
- **Configuration**: Set the build directory to `frontend/`. Vercel will automatically detect Next.js and apply the correct build commands (`npm run build`).
- **Environment**: Add `NEXT_PUBLIC_BACKEND_URL` to Vercel's environment variables, pointing it to the live Railway backend URL.
- **Goal**: Launch the Dashboard UI on a public `.vercel.app` domain so users can run tests from anywhere.

### 3. Agent Architecture Expansion
Once deployed, we will implement the remaining multi-agent logic:
- Replace the "Parallel Voting" and "Sequential Review" stubs with actual multi-agent routing algorithms using `litellm`.
- Integrate established datasets (GSM8K, MMLU-Pro) to allow for automated, batch reasoning evaluations instead of just manual, single-prompt UI tests.
- Begin collecting empirical data comparing reasoning accuracy vs. token cost.
