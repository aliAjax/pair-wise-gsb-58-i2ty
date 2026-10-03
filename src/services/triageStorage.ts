import type { TriageBatch } from "../models/types";

export const TRIAGE_STORAGE_KEY = "bank-fraud-triage-batches-v1";

export const readTriageBatches = (): TriageBatch[] => {
  if (typeof window === "undefined") {
    return [];
  }
  const stored = window.localStorage.getItem(TRIAGE_STORAGE_KEY);
  if (!stored) {
    return [];
  }
  try {
    const parsed = JSON.parse(stored) as TriageBatch[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const writeTriageBatches = (batches: TriageBatch[]): void => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TRIAGE_STORAGE_KEY, JSON.stringify(batches));
  }
};

export const upsertTriageBatch = (batch: TriageBatch): TriageBatch[] => {
  const batches = readTriageBatches();
  const exists = batches.some((item) => item.id === batch.id);
  const next = exists
    ? batches.map((item) => (item.id === batch.id ? batch : item))
    : [...batches, batch];
  writeTriageBatches(next);
  return next;
};

export const removeTriageBatch = (batchId: string): TriageBatch[] => {
  const next = readTriageBatches().filter((item) => item.id !== batchId);
  writeTriageBatches(next);
  return next;
};
