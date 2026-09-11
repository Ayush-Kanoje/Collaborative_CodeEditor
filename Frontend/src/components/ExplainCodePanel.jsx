import { useCallback, useEffect, useMemo, useState } from "react";
import { requestTrace } from "../services/traceApi";

const DELAYS = [400, 800, 1400];
const labels = { PROGRAM_START:"Program started", PROGRAM_END:"Program finished", ASSIGNMENT:"Assignment", MUTATION:"Data changed", CONDITION:"Condition", LOOP_START:"Loop started", LOOP_ITERATION:"Loop iteration", FUNCTION_CALL:"Function call", FUNCTION_RETURN:"Function return", OUTPUT:"Output", EXCEPTION:"Error" };
const show = (value) => JSON.stringify(value ?? null);

export function ExplainCodePanel({ code, onClose }) {
  const [trace, setTrace] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const lines = useMemo(() => code.split("\n"), [code]);
  const current = trace?.[step];
  const frame = current?.callStack?.at(-1) || "<module>";
  const variables = current?.afterState?.[frame] || {};
  const load = useCallback(async () => {
    if (!code.trim()) { setError("There is no Python code to explain."); setLoading(false); return; }
    setLoading(true); setError(""); setTrace(null); setStep(0); setPlaying(false);
    try { const result = await requestTrace(code); if (result.success) setTrace(result.trace); else setError(result.error); }
    catch { setError("Could not request an execution trace."); }
    finally { setLoading(false); }
  }, [code]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!playing || !trace) return undefined;
    const timer = setInterval(() => setStep((value) => {
      if (value >= trace.length - 1) { setPlaying(false); return value; }
      return value + 1;
    }), DELAYS[speed]);
    return () => clearInterval(timer);
  }, [playing, speed, trace]);
  const insight = current?.branchState ? `Condition is ${current.branchState.result ? "true" : "false"}.` : current?.loopState?.iteration !== undefined ? `Loop iteration ${current.loopState.iteration + 1}.` : current?.changedVariables?.length ? `${current.changedVariables.map((item) => item.name).join(", ")} changed.` : "State is unchanged.";
  return <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center"><section className="h-[90vh] w-full max-w-7xl overflow-hidden rounded-xl border border-neutral-700 bg-gray-950 shadow-2xl flex flex-col">
    <header className="flex items-center justify-between border-b border-neutral-700 bg-neutral-900 px-5 py-3"><div><h2 className="font-semibold text-white">Explain Code</h2><p className="text-xs text-gray-400">Verified execution trace</p></div><button onClick={onClose} className="text-xl text-gray-400 hover:text-white" aria-label="Close">×</button></header>
    {loading && <div className="flex-1 grid place-items-center text-gray-300"><div className="text-center"><div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />Tracing execution…</div></div>}
    {error && <div className="m-5 rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">{error}</div>}
    {trace && current && <><nav className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-5 py-2 text-sm"><span className="font-medium text-white">Step {step + 1} / {trace.length}</span><span className="text-amber-300">{labels[current.eventType] || current.eventType}</span><button onClick={() => setStep(0)} className="text-gray-300">Restart</button><button disabled={!step} onClick={() => setStep((x) => x - 1)} className="disabled:text-gray-600">Previous</button><button onClick={() => setPlaying(!playing)} className="rounded bg-amber-500 px-2 py-1 font-semibold text-gray-950">{playing ? "Pause" : "Play"}</button><button disabled={step === trace.length - 1} onClick={() => setStep((x) => x + 1)} className="disabled:text-gray-600">Next</button><label className="ml-auto text-gray-400">Speed <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="ml-1 rounded bg-neutral-800 text-white"><option value="0">Fast</option><option value="1">Normal</option><option value="2">Slow</option></select></label></nav>
      <div className="grid flex-1 min-h-0 grid-cols-1 gap-px bg-neutral-800 lg:grid-cols-[1.15fr_.85fr]"><div className="overflow-auto bg-[#1e1e1e] p-4 font-mono text-sm">{lines.map((line, index) => <div key={index} className={`grid min-h-6 grid-cols-[3rem_1fr] border-l-2 px-2 ${index + 1 === current.line ? "border-amber-400 bg-amber-400/20" : "border-transparent"}`}><span className="select-none text-gray-600">{index + 1}</span><code className="whitespace-pre text-gray-200">{line || " "}</code></div>)}</div>
        <div className="overflow-auto bg-gray-950 p-4 space-y-5"><div><p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Execution</p><p className="text-2xl text-white">Line {current.line}</p><p className="text-sm text-gray-400">{current.callStack.join(" → ")}</p>{current.output && <pre className="mt-3 rounded bg-sky-950/50 p-2 text-sm text-sky-200">› {current.output}</pre>}{current.error && <p className="mt-3 text-red-300">{current.error.message}</p>}</div><div><p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Variables</p>{Object.keys(variables).length ? <div className="space-y-2">{Object.entries(variables).map(([name, value]) => { const change = current.changedVariables.find((item) => item.name === name); return <div key={name} className={`border-l-2 pl-3 ${change ? "border-amber-400 bg-amber-400/10" : "border-neutral-700"}`}><p className="text-sky-300">{name}</p><p className="break-all text-gray-200">{show(value)}</p>{change && <p className="text-xs text-amber-300">{show(change.before)} → {show(change.after)}</p>}</div>; })}</div> : <p className="text-sm text-gray-500">No variables in this frame.</p>}</div><div className="border-l-2 border-emerald-400 pl-3"><p className="text-xs uppercase tracking-wide text-gray-500">Insight</p><p className="text-sm text-gray-200">{insight}</p></div></div></div></>}
  </section></div>;
}
