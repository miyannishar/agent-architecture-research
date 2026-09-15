from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import time
import os
from dotenv import load_dotenv

# Load environment variables (like OPENAI_API_KEY)
load_dotenv()

# We will import the agent execution function here
from agents.evaluator import run_agent_test

app = FastAPI(title="ADK Agent Test API")

# Allow CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For production, restrict this to the Vercel domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TestRequest(BaseModel):
    architecture: str # "single_agent", "parallel_voting", "sequential_review"
    task_prompt: str

class TestResult(BaseModel):
    architecture: str
    result: str
    latency_ms: float
    token_usage: int
    cost_estimate: float

@app.get("/")
def health_check():
    return {"status": "ok", "message": "Backend is running!"}

@app.post("/api/run-test", response_model=TestResult)
async def run_test(request: TestRequest):
    try:
        # Measure time
        start_time = time.time()
        
        # Execute the ADK agent logic
        output, token_usage, cost = run_agent_test(request.architecture, request.task_prompt)
        
        end_time = time.time()
        latency = (end_time - start_time) * 1000
        
        return TestResult(
            architecture=request.architecture,
            result=output,
            latency_ms=latency,
            token_usage=token_usage,
            cost_estimate=cost
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
