export async function requestTrace(code) {
  const response = await fetch("/api/trace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "python", code }),
  });
  const result = await response.json();
  if (result.status === "completed") {
    return { success: true, trace: result.trace.events || [] };
  }
  return {
    success: false,
    error: result.error?.message || "Trace generation failed.",
    trace: result.trace?.events || [],
  };
}
