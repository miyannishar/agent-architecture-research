'use client';

import { useState } from 'react';

export default function Home() {
  const [architecture, setArchitecture] = useState('single_agent');
  const [prompt, setPrompt] = useState('Solve the following math problem: If I have 3 apples and give 1 away, how many do I have?');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const runTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      // In development, this would point to localhost:8000
      // For Vercel/Render, we'd use an env variable for the backend URL
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
      
      const response = await fetch(`${backendUrl}/api/run-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ architecture, task_prompt: prompt }),
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
      }

      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred while running the test.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 font-sans p-8">
      <div className="max-w-4xl mx-auto bg-white shadow-xl rounded-2xl p-8">
        <header className="mb-8 border-b pb-6">
          <h1 className="text-3xl font-bold text-gray-800">Agentic Architecture Evaluator</h1>
          <p className="text-gray-500 mt-2">Test and compare reasoning performance across different LLM agent architectures.</p>
        </header>

        <form onSubmit={runTest} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Agent Architecture</label>
            <select 
              value={architecture}
              onChange={(e) => setArchitecture(e.target.value)}
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 p-3 border"
            >
              <option value="single_agent">Single-Agent Baseline</option>
              <option value="parallel_voting">Parallel Voting</option>
              <option value="sequential_review">Sequential Review</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Reasoning Task / Prompt</label>
            <textarea 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 p-3 border"
              placeholder="Enter the task for the agent(s)..."
            ></textarea>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className={`w-full py-3 px-4 text-white font-semibold rounded-lg shadow-md transition-colors ${loading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {loading ? 'Running Test...' : 'Run Evaluation'}
          </button>
        </form>

        {error && (
          <div className="mt-8 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-8 p-6 bg-gray-50 border border-gray-200 rounded-xl">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Evaluation Results</h2>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                <p className="text-sm text-gray-500">Latency</p>
                <p className="text-xl font-bold text-gray-900">{result.latency_ms.toFixed(2)} ms</p>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                <p className="text-sm text-gray-500">Tokens Used</p>
                <p className="text-xl font-bold text-gray-900">{result.token_usage}</p>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                <p className="text-sm text-gray-500">Est. Cost</p>
                <p className="text-xl font-bold text-gray-900">${result.cost_estimate.toFixed(6)}</p>
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <p className="text-sm text-gray-500 mb-2">Final Reasoning Output</p>
              <div className="text-gray-800 whitespace-pre-wrap bg-gray-50 p-4 rounded font-mono text-sm">
                {result.result}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
