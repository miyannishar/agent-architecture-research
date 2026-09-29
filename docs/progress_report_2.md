# Progress Report: Weeks 5 and 6

## 1. Work Completed
During Weeks 5 and 6, the primary focus was transitioning the project from a local development environment to a live, publicly accessible platform, and laying the theoretical groundwork for the automated evaluation pipelines. The specific accomplishments include:

1. **Cloud Deployment (Vercel & Railway)**: 
   - We successfully deployed the Next.js frontend Dashboard to Vercel, leveraging its zero-configuration CI/CD pipeline for React applications.
   - We deployed the FastAPI backend to Railway using the containerized Docker configuration. The backend is now actively listening for API requests and securely managing the OpenAI API keys in the cloud.
2. **Benchmark Dataset Research**:
   - Conducted an in-depth review of reasoning benchmark datasets to determine the best candidates for evaluating single-agent vs. multi-agent architectures.
   - We finalized the selection of two primary datasets for our upcoming experiments: **GSM8K** (Grade School Math 8K, ideal for testing step-by-step logical reasoning) and **MMLU-Pro** (Massive Multitask Language Understanding, ideal for complex, multi-disciplinary reasoning).

## 2. Methods and Approaches
- **Continuous Integration / Continuous Deployment (CI/CD)**: We connected our central GitHub repository directly to Vercel and Railway. This approach ensures that any future code changes to the agent architectures or frontend UI are automatically built and deployed without manual intervention.
- **Dataset Evaluation Methodology**: We evaluated potential datasets based on their ability to expose "hallucinations" and measure reasoning depth. GSM8K was chosen because its deterministic math problems allow for objective accuracy scoring, which is crucial for determining if "Parallel Voting" actually improves mathematical reasoning over a single agent.

## 3. Results and Outcomes
- **Live Evaluation Platform**: The decoupled microservice architecture is now fully online. The Vercel frontend is securely communicating with the Railway backend via the `NEXT_PUBLIC_BACKEND_URL` environment variable.
- **Experiment Readiness**: By finalizing the research into GSM8K and MMLU-Pro, we now have a clear roadmap for the data structures required to build the automated evaluation loop in the backend.

## 4. Challenges Encountered
- **Environment Variable Synchronization**: One of the main challenges was ensuring the Vercel frontend correctly routed requests to the live Railway backend instead of `localhost`. This required securely configuring CORS (Cross-Origin Resource Sharing) policies on the FastAPI server to accept incoming requests specifically from the Vercel domain, and ensuring API keys were properly injected into Railway's production environment. 

## 5. Plans for the Next Stage
For the upcoming weeks, the project will shift focus from infrastructure to the core AI architecture and experimentation:
1. **Implement Multi-Agent Architectures**: We will replace the current execution stubs with fully functional implementations of "Parallel Voting" and "Sequential Review" using the `litellm` execution engine.
2. **Automated Evaluation Loop**: We will write a Python script in the backend to programmatically pull questions from the GSM8K dataset, run them through the various agent architectures, and log the accuracy, token usage, and latency.
3. **Data Collection**: Begin our first official round of empirical data collection to compare single-agent baselines against the multi-agent topologies.
