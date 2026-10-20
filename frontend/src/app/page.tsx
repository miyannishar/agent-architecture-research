'use client';

import { useMemo, useState } from 'react';

type Architecture = 'parallel_voting' | 'sequential_review' | 'debate';
type RunMode = 'normal' | 'output_cap';

interface BenchmarkConfig {
  name: string;
  architecture: string;
  num_agents: number;
  rounds: number;
}

interface BenchmarkSummary extends BenchmarkConfig {
  n_answered: number;
  errors: number;
  accuracy: number | null;
  ci95_low: number | null;
  ci95_high: number | null;
  mean_calls: number | null;
  mean_tokens: number | null;
  mean_input_tokens: number | null;
  mean_output_tokens: number | null;
  mean_latency_s: number | null;
  mean_cost: number | null;
  paired_n?: number;
  gained?: number;
  lost?: number;
  paired_delta_accuracy?: number | null;
}

interface BenchmarkCase {
  config: string;
  qid: number;
  prompt: string;
  gold: string;
  pred?: string;
  correct: boolean | null;
  error?: string;
  trace?: string[];
}

interface BenchmarkRun {
  run_id: string;
  created_at: string;
  dataset: { name: string; sha256: string; rows: number };
  seed: number;
  questions: number;
  model: string;
  mode: RunMode;
  normal_max_tokens_per_call: number | null;
  output_budget: number | null;
  planned_model_calls: number;
  results_file: string;
  summaries: BenchmarkSummary[];
  cases: BenchmarkCase[];
}

interface QuickResult {
  architecture: string;
  result: string;
  final_answer: string;
  num_agents: number;
  num_calls: number;
  latency_ms: number;
  token_usage: number;
  cost_estimate: number;
}

const architectureNames: Record<Architecture, string> = {
  parallel_voting: 'Parallel voting',
  sequential_review: 'Sequential review',
  debate: 'Multi-agent debate',
};

const callCount = (architecture: Architecture, agents: number, rounds: number) =>
  architecture === 'debate' ? agents * (1 + rounds) : agents;

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function errorMessage(response: Response, body: { detail?: string } | null) {
  return body?.detail || `Request failed (${response.status} ${response.statusText})`;
}

export default function Home() {
  const [activeView, setActiveView] = useState<'benchmark' | 'quick'>('benchmark');
  const [sampleSize, setSampleSize] = useState(5);
  const [seed, setSeed] = useState(0);
  const [mode, setMode] = useState<RunMode>('normal');
  const [outputBudget, setOutputBudget] = useState(3000);
  const [rounds, setRounds] = useState(1);
  const [agents, setAgents] = useState<Record<Architecture, number>>({
    parallel_voting: 3,
    sequential_review: 3,
    debate: 3,
  });
  const [selected, setSelected] = useState<Record<Architecture, boolean>>({
    parallel_voting: true,
    sequential_review: true,
    debate: true,
  });
  const [acknowledgedCost, setAcknowledgedCost] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [benchmark, setBenchmark] = useState<BenchmarkRun | null>(null);
  const [caseFilter, setCaseFilter] = useState<'all' | 'changed'>('all');
  const [quickPrompt, setQuickPrompt] = useState('Solve the following math problem: If I have 3 apples and give 1 away, how many do I have?');
  const [quickArchitecture, setQuickArchitecture] = useState('single_agent');
  const [quickAgents, setQuickAgents] = useState(3);
  const [quickResult, setQuickResult] = useState<QuickResult | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);

  const configured = useMemo(() => (Object.keys(selected) as Architecture[])
    .filter((architecture) => selected[architecture])
    .map((architecture) => ({ architecture, num_agents: agents[architecture], rounds: architecture === 'debate' ? rounds : 1 })),
  [agents, rounds, selected]);

  const estimatedCalls = sampleSize * (1 + configured.reduce(
    (total, config) => total + callCount(config.architecture, config.num_agents, config.rounds), 0,
  ));
  const largestCallGroup = Math.max(1, ...configured.map((config) => callCount(config.architecture, config.num_agents, config.rounds)));
  const requestTooLarge = estimatedCalls > 120 || (mode === 'output_cap' && outputBudget < largestCallGroup * 64);

  const runBenchmark = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRunning(true);
    setRunError('');
    setBenchmark(null);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${backendUrl}/api/benchmark/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          n: sampleSize,
          seed,
          mode,
          max_tokens: 1024,
          output_budget: outputBudget,
          configs: configured,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(response, body));
      setBenchmark(body as BenchmarkRun);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The benchmark could not be started.';
      setRunError(message === 'Failed to fetch'
        ? 'Could not connect to the benchmark API. Check that the backend is running and reachable.'
        : message);
    } finally {
      setRunning(false);
    }
  };

  const runQuickTest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuickBusy(true);
    setRunError('');
    setQuickResult(null);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${backendUrl}/api/run-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          architecture: quickArchitecture,
          task_prompt: quickPrompt,
          num_agents: quickArchitecture === 'single_agent' ? 1 : quickAgents,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(response, body));
      setQuickResult(body as QuickResult);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'The evaluation could not be completed.');
    } finally {
      setQuickBusy(false);
    }
  };

  const exportRun = () => {
    if (!benchmark) return;
    const blob = new Blob([JSON.stringify(benchmark, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `${benchmark.run_id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const casesByQuestion = useMemo(() => {
    if (!benchmark) return [];
    const grouped = new Map<number, BenchmarkCase[]>();
    for (const item of benchmark.cases) grouped.set(item.qid, [...(grouped.get(item.qid) || []), item]);
    return [...grouped.entries()].sort(([a], [b]) => a - b);
  }, [benchmark]);

  const changedCaseGroups = casesByQuestion.filter(([, items]) => {
    const baseline = items.find((item) => item.config === 'single_agent:1');
    return baseline?.correct !== null && baseline?.correct !== undefined
      && items.some((item) => item.config !== 'single_agent:1'
        && item.correct !== null && item.correct !== baseline.correct);
  });
  const visibleCaseGroups = caseFilter === 'changed' ? changedCaseGroups : casesByQuestion;

  const exportSummaryCsv = () => {
    if (!benchmark) return;
    const columns = [
      'run_id', 'model', 'dataset_sha256', 'seed', 'config', 'questions', 'answered', 'errors',
      'accuracy', 'ci95_low', 'ci95_high', 'mean_calls', 'mean_input_tokens', 'mean_output_tokens',
      'mean_tokens', 'mean_latency_s', 'mean_cost', 'paired_n', 'gained', 'lost', 'paired_delta_accuracy',
    ];
    const records = benchmark.summaries.map((summary) => ({
      run_id: benchmark.run_id,
      model: benchmark.model,
      dataset_sha256: benchmark.dataset.sha256,
      seed: benchmark.seed,
      config: summary.name,
      questions: benchmark.questions,
      answered: summary.n_answered,
      errors: summary.errors,
      accuracy: summary.accuracy,
      ci95_low: summary.ci95_low,
      ci95_high: summary.ci95_high,
      mean_calls: summary.mean_calls,
      mean_input_tokens: summary.mean_input_tokens,
      mean_output_tokens: summary.mean_output_tokens,
      mean_tokens: summary.mean_tokens,
      mean_latency_s: summary.mean_latency_s,
      mean_cost: summary.mean_cost,
      paired_n: summary.paired_n,
      gained: summary.gained,
      lost: summary.lost,
      paired_delta_accuracy: summary.paired_delta_accuracy,
    }));
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [columns.map(escape).join(','), ...records.map((record) =>
      columns.map((column) => escape(record[column as keyof typeof record])).join(','),
    )].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `${benchmark.run_id}-summary.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return (
    <main className="min-h-screen bg-[#f4f3ee] px-4 py-6 text-[#172420] sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col justify-between gap-6 border-b border-[#d9ded7] pb-6 md:flex-row md:items-end">
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#183d34] text-xs font-black tracking-tight text-white">AR</div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#477464]">Agent Research Lab</p>
              <span className="rounded-full border border-[#d9ded7] bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#6f7a72]">GSM8K · Paired evaluation</span>
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">When does teamwork pay?</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[#65716a]">
              Compare reasoning systems on the same GSM8K questions, then inspect what extra calls and tokens buy.
            </p>
          </div>
          <div role="group" aria-label="Evaluation views" className="flex items-center gap-1 rounded-xl border border-[#d9ded7] bg-white p-1.5 text-sm font-semibold shadow-sm">
            <button type="button" aria-pressed={activeView === 'benchmark'} onClick={() => { setActiveView('benchmark'); setRunError(''); }} className={`rounded-lg px-4 py-2 transition ${activeView === 'benchmark' ? 'bg-[#183d34] text-white shadow-sm' : 'text-[#65716a] hover:bg-[#f1f3ef]'}`}>Benchmark lab</button>
            <button type="button" aria-pressed={activeView === 'quick'} onClick={() => { setActiveView('quick'); setRunError(''); }} className={`rounded-lg px-4 py-2 transition ${activeView === 'quick' ? 'bg-[#183d34] text-white shadow-sm' : 'text-[#65716a] hover:bg-[#f1f3ef]'}`}>Quick test</button>
          </div>
        </header>

        {activeView === 'benchmark' ? (
          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <section className="h-fit rounded-3xl border border-[#dce1da] bg-white p-6 shadow-[0_12px_36px_rgba(28,52,43,0.06)]">
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#e47746]">Experiment setup</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">Build a paired run</h2>
                <p className="mt-2 text-sm leading-6 text-[#6b766e]">Every selected system receives the same seeded questions. The single agent is included as the baseline.</p>
              </div>

              <form onSubmit={runBenchmark} className="space-y-6">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-semibold text-[#46534b]">Questions
                    <input type="number" min={1} max={50} value={sampleSize} onChange={(event) => setSampleSize(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-[#d8ded7] bg-[#fbfcfa] px-3 py-2.5 text-base text-[#172420] outline-none focus:border-[#477464] focus:ring-2 focus:ring-[#477464]/15" />
                  </label>
                  <label className="text-sm font-semibold text-[#46534b]">Seed
                    <input type="number" min={0} value={seed} onChange={(event) => setSeed(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-[#d8ded7] bg-[#fbfcfa] px-3 py-2.5 text-base text-[#172420] outline-none focus:border-[#477464] focus:ring-2 focus:ring-[#477464]/15" />
                  </label>
                </div>

                <fieldset className="space-y-2">
                  <legend className="mb-3 text-sm font-bold text-[#46534b]">Architectures</legend>
                  {(Object.keys(architectureNames) as Architecture[]).map((architecture) => (
                    <div key={architecture} className={`rounded-2xl border p-3 transition ${selected[architecture] ? 'border-[#a9c4b7] bg-[#f2f7f2]' : 'border-[#e5e9e3] bg-white'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex min-w-0 cursor-pointer items-center gap-3 text-sm font-semibold">
                          <input type="checkbox" checked={selected[architecture]} onChange={(event) => setSelected({ ...selected, [architecture]: event.target.checked })} className="h-4 w-4 accent-[#24594a]" />
                          <span>{architectureNames[architecture]}</span>
                        </label>
                        <select aria-label={`${architectureNames[architecture]} agent count`} disabled={!selected[architecture]} value={agents[architecture]} onChange={(event) => setAgents({ ...agents, [architecture]: Number(event.target.value) })} className="rounded-lg border border-[#d8ded7] bg-white px-2 py-1.5 text-sm disabled:opacity-40">
                          {[2, 3, 5].map((count) => <option key={count} value={count}>{count} agents</option>)}
                        </select>
                      </div>
                      {architecture === 'debate' && selected.debate && (
                        <div className="mt-3 flex items-center justify-between border-t border-[#d9e5dc] pt-3 text-xs text-[#69766d]">
                          <span>Revision rounds</span>
                          <select value={rounds} onChange={(event) => setRounds(Number(event.target.value))} className="rounded-lg border border-[#d8ded7] bg-white px-2 py-1.5 text-sm text-[#26382f]">
                            {[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  ))}
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="mb-3 text-sm font-bold text-[#46534b]">Compute condition</legend>
                  <label className={`block cursor-pointer rounded-2xl border p-3 ${mode === 'normal' ? 'border-[#a9c4b7] bg-[#f2f7f2]' : 'border-[#e5e9e3]'}`}>
                    <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" checked={mode === 'normal'} onChange={() => setMode('normal')} className="accent-[#24594a]" /> Fixed cap per call</span>
                    <span className="ml-6 mt-1 block text-xs leading-5 text-[#748078]">Each request can generate up to 1,024 completion tokens.</span>
                  </label>
                  <label className={`block cursor-pointer rounded-2xl border p-3 ${mode === 'output_cap' ? 'border-[#a9c4b7] bg-[#f2f7f2]' : 'border-[#e5e9e3]'}`}>
                    <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" checked={mode === 'output_cap'} onChange={() => setMode('output_cap')} className="accent-[#24594a]" /> Shared output-token cap</span>
                    <span className="ml-6 mt-1 block text-xs leading-5 text-[#748078]">Divides a completion-token ceiling by each system&apos;s call count. Input tokens still vary.</span>
                    {mode === 'output_cap' && <input aria-label="Output token cap per task" type="number" min={64} step={64} value={outputBudget} onChange={(event) => setOutputBudget(Number(event.target.value))} className="ml-6 mt-3 w-[calc(100%-1.5rem)] rounded-lg border border-[#d8ded7] bg-white px-3 py-2 text-sm" />}
                  </label>
                </fieldset>

                <div className="rounded-2xl bg-[#183d34] p-4 text-white">
                  <div className="flex items-end justify-between gap-3">
                    <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#b9d1c5]">Estimated model calls</p><p className="mt-1 text-3xl font-semibold tabular-nums">{estimatedCalls}</p></div>
                    <p className="max-w-32 text-right text-xs leading-5 text-[#c8d8d0]">{sampleSize} questions × {1 + configured.reduce((sum, config) => sum + callCount(config.architecture, config.num_agents, config.rounds), 0)} calls per question</p>
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-[#69766d]">
                  <input type="checkbox" checked={acknowledgedCost} onChange={(event) => setAcknowledgedCost(event.target.checked)} className="mt-0.5 accent-[#24594a]" />
                  This run uses the configured LLM API and may incur provider charges.
                </label>

                {requestTooLarge && <p role="alert" className="rounded-xl bg-[#fff1e8] p-3 text-sm text-[#9a4828]">Reduce the sample or agent count to fit the 120-call limit. The output cap must allow at least 64 tokens per call.</p>}
                <button type="submit" disabled={running || !acknowledgedCost || requestTooLarge} className="w-full rounded-xl bg-[#e47746] px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#cb6338] disabled:cursor-not-allowed disabled:bg-[#c8cec8]">
                  {running ? 'Running paired benchmark…' : 'Run GSM8K benchmark'}
                </button>
                <p className="text-center text-xs text-[#8a948d]">Real benchmark mode. Mock responses are blocked.</p>
              </form>
            </section>

            <section className="min-w-0 space-y-6">
              {runError && <div role="alert" className="rounded-2xl border border-[#efc5b6] bg-[#fff5f0] p-4 text-sm text-[#8f3f27]">{runError}</div>}
              {!benchmark && !running && (
                <div className="flex min-h-[520px] flex-col justify-between overflow-hidden rounded-3xl bg-[#dfe9df] p-8 sm:p-10">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#477464]">Research question</p>
                    <h2 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">Do extra agents improve reasoning enough to justify their cost?</h2>
                    <p className="mt-5 max-w-xl leading-7 text-[#53645a]">Start with a small paired run. Each architecture sees the same seeded GSM8K subset, so you can compare where collaboration helped, where it hurt, and what it consumed.</p>
                  </div>
                  <div className="mt-12 grid gap-3 sm:grid-cols-3">
                    {[
                      ['01', 'Shared questions', 'One seed, same items'],
                      ['02', 'Paired outcomes', 'Gained and lost cases'],
                      ['03', 'Run provenance', 'Model and data fingerprint'],
                    ].map(([number, title, caption]) => <div key={number} className="rounded-2xl border border-[#c8d8cb] bg-white/70 p-4"><span className="text-xs font-bold text-[#e47746]">{number}</span><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-1 text-xs text-[#748078]">{caption}</p></div>)}
                  </div>
                </div>
              )}
              {running && <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-[#dce1da] bg-white p-10 text-center"><div><div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-[#dce8df] border-t-[#e47746]" /><h2 className="text-xl font-semibold">Working through the question set</h2><p className="mt-2 text-sm text-[#748078]">The API saves each result row as it completes. This can take a few minutes.</p></div></div>}

              {benchmark && (
                <>
                  <div className="flex flex-col justify-between gap-4 rounded-3xl bg-[#183d34] p-6 text-white sm:flex-row sm:items-start sm:p-8">
                    <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b8d1c3]">Run complete · {benchmark.questions} questions</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Comparison results</h2><p className="mt-2 text-sm text-[#c9d8d0]">{benchmark.model} · seed {benchmark.seed} · {benchmark.planned_model_calls} planned model calls</p></div>
                    <div className="flex gap-2">
                      <button type="button" onClick={exportSummaryCsv} className="rounded-xl border border-white/25 px-4 py-2 text-sm font-semibold transition hover:bg-white/10">Summary CSV</button>
                      <button type="button" onClick={exportRun} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#183d34] transition hover:bg-[#e8efe9]">Full run JSON</button>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-3xl border border-[#dce1da] bg-white shadow-[0_12px_36px_rgba(28,52,43,0.04)]">
                    <div className="border-b border-[#e8ece6] px-6 py-5"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#e47746]">Architecture scorecard</p><p className="mt-1 text-sm text-[#78837b]">Accuracy includes only successful responses. Bars show accuracy; intervals use the Wilson 95% method.</p></div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-sm">
                        <thead className="bg-[#f8f9f6] text-xs uppercase tracking-wide text-[#7a857d]"><tr><th className="px-5 py-3 font-bold">System</th><th className="px-5 py-3 font-bold">Accuracy</th><th className="px-5 py-3 font-bold">Calls</th><th className="px-5 py-3 font-bold">Tokens</th><th className="px-5 py-3 font-bold">Latency</th><th className="px-5 py-3 font-bold">Cost</th><th className="px-5 py-3 font-bold">Vs baseline</th></tr></thead>
                        <tbody className="divide-y divide-[#edf0eb]">
                          {benchmark.summaries.map((summary) => (
                            <tr key={summary.name}>
                              <td className="px-5 py-4"><p className="font-bold text-[#26382f]">{summary.architecture === 'single_agent' ? 'Single agent · baseline' : architectureNames[summary.architecture as Architecture]}</p><p className="mt-1 text-xs text-[#869088]">{summary.num_agents} agent{summary.num_agents === 1 ? '' : 's'} · {summary.n_answered}/{benchmark.questions} answered{summary.errors > 0 ? ` · ${summary.errors} errors` : ''}</p></td>
                              <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="h-2 w-20 overflow-hidden rounded-full bg-[#e9eee8]"><div className="h-full rounded-full bg-[#39836a]" style={{ width: `${(summary.accuracy || 0) * 100}%` }} /></div><div className="whitespace-nowrap font-bold tabular-nums">{summary.accuracy === null ? '—' : `${(summary.accuracy * 100).toFixed(0)}%`}<span className="mt-1 block text-[10px] font-normal text-[#879188]">95% CI {summary.ci95_low === null || summary.ci95_high === null ? '—' : `${(summary.ci95_low * 100).toFixed(0)}–${(summary.ci95_high * 100).toFixed(0)}%`}</span></div></div></td>
                              <td className="px-5 py-4 tabular-nums">{summary.mean_calls?.toFixed(1) ?? '—'}</td>
                              <td className="px-5 py-4 tabular-nums"><span>{summary.mean_tokens?.toFixed(0) ?? '—'}</span><span className="mt-1 block whitespace-nowrap text-[10px] text-[#879188]">in {summary.mean_input_tokens?.toFixed(0) ?? '—'} · out {summary.mean_output_tokens?.toFixed(0) ?? '—'}</span></td>
                              <td className="px-5 py-4 tabular-nums">{summary.mean_latency_s?.toFixed(2) ?? '—'}s</td>
                              <td className="px-5 py-4 tabular-nums">${summary.mean_cost?.toFixed(5) ?? '—'}</td>
                              <td className="px-5 py-4">{summary.name === 'single_agent:1' ? <span className="text-xs text-[#929b94]">Reference</span> : <div className="whitespace-nowrap"><span className={`font-bold ${((summary.paired_delta_accuracy || 0) >= 0) ? 'text-[#33785e]' : 'text-[#b2553a]'}`}>{formatPercent(summary.paired_delta_accuracy)}</span><span className="ml-2 text-xs text-[#858f87]">+{summary.gained ?? 0} / −{summary.lost ?? 0}</span></div>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-[#dce1da] bg-white p-6 shadow-[0_12px_36px_rgba(28,52,43,0.04)] sm:p-7">
                    <div className="flex flex-col justify-between gap-3 border-b border-[#e8ece6] pb-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#e47746]">Failure analysis</p><h3 className="mt-1 text-xl font-semibold">Inspect each paired question</h3><p className="mt-1 text-xs text-[#879188]">Open a row to compare answers against the GSM8K key.</p></div><div className="flex shrink-0 items-center gap-1 rounded-lg bg-[#f3f5f1] p-1 text-xs font-semibold"><button type="button" aria-pressed={caseFilter === 'all'} onClick={() => setCaseFilter('all')} className={`rounded-md px-3 py-2 transition ${caseFilter === 'all' ? 'bg-white text-[#26382f] shadow-sm' : 'text-[#738078]'}`}>All ({casesByQuestion.length})</button><button type="button" aria-pressed={caseFilter === 'changed'} onClick={() => setCaseFilter('changed')} className={`rounded-md px-3 py-2 transition ${caseFilter === 'changed' ? 'bg-white text-[#26382f] shadow-sm' : 'text-[#738078]'}`}>Correctness changed ({changedCaseGroups.length})</button></div></div>
                    <div className="mt-3 max-h-[620px] divide-y divide-[#edf0eb] overflow-y-auto">
                      {visibleCaseGroups.map(([qid, items]) => (
                        <details key={qid} className="group py-3">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-1 text-sm hover:bg-[#f8f9f6]">
                            <span className="font-semibold">Question {qid}</span>
                            <span className="flex items-center gap-3 text-xs text-[#7f8a82]"><span>{items.length} systems</span><span className="transition group-open:rotate-180">⌄</span></span>
                          </summary>
                          <p className="my-3 whitespace-pre-wrap rounded-xl bg-[#f7f8f5] p-4 text-sm leading-6 text-[#536159]">{items[0]?.prompt}</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {items.map((item) => <div key={item.config} className="rounded-xl border border-[#e8ece6] p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{item.config.replace('_', ' ')}</span><span className={item.correct === null ? 'text-[#a05b34]' : item.correct ? 'text-[#287354]' : 'text-[#b2553a]'}>{item.correct === null ? 'Error' : item.correct ? 'Correct' : 'Missed'}</span></div><p className="mt-2 text-xs text-[#7d8980]">Predicted <strong className="text-[#33443a]">{item.pred || 'No parsed answer'}</strong> · expected <strong className="text-[#33443a]">{item.gold}</strong></p>{item.trace && item.trace.length > 0 && <p className="mt-2 text-xs text-[#7d8980]">Agent answers: <span className="font-medium text-[#536159]">{item.trace.join(' · ')}</span></p>}{item.error && <p className="mt-2 text-xs text-[#a05b34]">{item.error}</p>}</div>)}
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#dce1da] bg-white/70 px-5 py-4 text-xs leading-5 text-[#77827a]">
                    <p><strong className="text-[#46534b]">Reproducibility record</strong> · run {benchmark.run_id} · GSM8K SHA-256 <code className="break-all">{benchmark.dataset.sha256}</code> · {benchmark.dataset.rows.toLocaleString()} source rows · {benchmark.mode === 'normal' ? 'fixed completion cap per call' : `shared ${benchmark.output_budget?.toLocaleString()} completion-token cap`} · raw rows: <code>{benchmark.results_file}</code></p>
                    <p className="mt-2">The output-cap condition limits completion tokens only; input-token use and total compute can still differ by architecture. Small samples are exploratory; the scorecard uses Wilson 95% intervals.</p>
                  </div>
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <section className="rounded-3xl border border-[#dce1da] bg-white p-6 shadow-sm sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#e47746]">One-off evaluation</p><h2 className="mt-2 text-2xl font-semibold">Try an architecture</h2><p className="mt-2 text-sm leading-6 text-[#6b766e]">Explore the interaction flow with a custom task. Use Benchmark Lab for paired research runs.</p>
              <form onSubmit={runQuickTest} className="mt-6 space-y-5">
                <label className="block text-sm font-semibold text-[#46534b]">Architecture<select value={quickArchitecture} onChange={(event) => setQuickArchitecture(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d8ded7] bg-[#fbfcfa] px-3 py-3 font-normal"><option value="single_agent">Single agent</option><option value="parallel_voting">Parallel voting</option><option value="sequential_review">Sequential review</option><option value="debate">Multi-agent debate</option></select></label>
                {quickArchitecture !== 'single_agent' && <label className="block text-sm font-semibold text-[#46534b]">Agents<select value={quickAgents} onChange={(event) => setQuickAgents(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-[#d8ded7] bg-[#fbfcfa] px-3 py-3 font-normal">{[2, 3, 5].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>}
                <label className="block text-sm font-semibold text-[#46534b]">Task<textarea value={quickPrompt} onChange={(event) => setQuickPrompt(event.target.value)} rows={6} className="mt-2 w-full resize-y rounded-xl border border-[#d8ded7] bg-[#fbfcfa] px-3 py-3 font-normal leading-6" /></label>
                <button type="submit" disabled={quickBusy} className="w-full rounded-xl bg-[#183d34] px-4 py-3 font-semibold text-white hover:bg-[#24594a] disabled:bg-[#aeb9b1]">{quickBusy ? 'Running…' : 'Run one-off task'}</button>
              </form>
              {runError && <div role="alert" className="mt-5 rounded-xl bg-[#fff5f0] p-3 text-sm text-[#8f3f27]">{runError}</div>}
            </section>
            <section className="rounded-3xl bg-[#dfe9df] p-6 sm:p-8">
              {quickResult ? <><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#477464]">Response</p><h2 className="mt-2 text-2xl font-semibold">Answer: {quickResult.final_answer || 'No answer parsed'}</h2><div className="mt-5 grid grid-cols-2 gap-3">{[['Calls', quickResult.num_calls], ['Tokens', quickResult.token_usage], ['Latency', `${quickResult.latency_ms.toFixed(0)} ms`], ['Est. cost', `$${quickResult.cost_estimate.toFixed(5)}`]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-white/80 p-4"><p className="text-xs text-[#78837b]">{label}</p><p className="mt-1 font-bold">{value}</p></div>)}</div><pre className="mt-5 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-white/80 p-4 text-sm leading-6">{quickResult.result}</pre></> : <><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#477464]">What to compare</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">A quick probe can expose a mechanism.</h2><p className="mt-4 leading-7 text-[#53645a]">Does review correct the initial answer? Does debate change a correct majority? The benchmark view helps check those patterns across a shared question set rather than relying on one example.</p><div className="mt-10 rounded-2xl border border-[#c8d8cb] bg-white/70 p-5"><p className="text-sm font-bold">Research note</p><p className="mt-2 text-sm leading-6 text-[#69766d]">One-off answers are useful for exploration, but they are not accuracy evidence. The benchmark runner stores question-level predictions and matched baseline outcomes.</p></div></>}
            </section>
          </div>
        )}

        <footer className="mt-10 flex flex-col justify-between gap-2 border-t border-[#d9ded7] pt-5 text-xs text-[#929b94] sm:flex-row"><span>Single-agent vs. multi-agent reasoning research</span><span>GSM8K · paired evaluation · measured compute</span></footer>
      </div>
    </main>
  );
}
