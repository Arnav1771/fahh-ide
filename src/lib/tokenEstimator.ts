/**
 * Fast client-side token estimation based on character and whitespace heuristics (~3.8 chars/token for code/English).
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text || text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 3.8));
}

export interface ContextTokenBreakdown {
  promptTokens: number;
  activeFileTokens: number;
  selectionTokens: number;
  diagnosticsTokens: number;
  totalTokens: number;
  formatted: string;
}

export function calculateContextTokens(params: {
  prompt: string;
  activeFileContent?: string | null;
  selection?: string | null;
  diagnosticsCount?: number;
}): ContextTokenBreakdown {
  const promptTokens = estimateTokens(params.prompt);
  const activeFileTokens = estimateTokens(params.activeFileContent);
  const selectionTokens = estimateTokens(params.selection);
  const diagnosticsTokens = (params.diagnosticsCount ?? 0) * 15;
  const totalTokens = promptTokens + activeFileTokens + selectionTokens + diagnosticsTokens;

  let formatted = `${totalTokens}`;
  if (totalTokens >= 1000) {
    formatted = `${(totalTokens / 1000).toFixed(1)}k`;
  }

  return {
    promptTokens,
    activeFileTokens,
    selectionTokens,
    diagnosticsTokens,
    totalTokens,
    formatted,
  };
}
