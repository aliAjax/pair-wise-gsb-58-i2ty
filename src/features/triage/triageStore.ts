import { useSyncExternalStore } from "react";
import type {
  Alert,
  TriageAction,
  TriageBatch,
  TriageEvidenceDraft,
} from "../../models/types";
import {
  createId,
  nowIso,
  readDatabase,
  readTriageQueue,
  writeTriageQueue,
} from "../../services/mockStorage";

export const CURRENT_ACTOR = "林澜";
const ACTIVE_BATCH_KEY = "bank-fraud-investigation-active-triage-batch";

const listeners = new Set<() => void>();

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

if (typeof window !== "undefined") {
  // 另一个窗口提交/修改批次后，本窗口即时刷新
  window.addEventListener("storage", (event) => {
    if (
      event.key === "bank-fraud-investigation-triage-v1" ||
      event.key === ACTIVE_BATCH_KEY
    ) {
      emit();
    }
  });
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTriageQueue = (): TriageBatch[] =>
  useSyncExternalStore(
    subscribe,
    () => readTriageQueue(),
    () => [],
  );

export const getActiveBatchId = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.localStorage.getItem(ACTIVE_BATCH_KEY) ?? undefined;
};

export const useActiveBatchId = (): string | undefined =>
  useSyncExternalStore(
    subscribe,
    () => getActiveBatchId(),
    () => undefined,
  );

const setActiveBatchId = (id: string | undefined): void => {
  if (typeof window === "undefined") {
    return;
  }
  if (id) {
    window.localStorage.setItem(ACTIVE_BATCH_KEY, id);
  } else {
    window.localStorage.removeItem(ACTIVE_BATCH_KEY);
  }
  emit();
};

const saveQueue = (queue: TriageBatch[]): void => {
  writeTriageQueue(queue);
  emit();
};

const snapshotAction = (
  alert: Alert,
  kind: TriageAction["kind"],
  caseId?: string,
): TriageAction => ({
  alertId: alert.id,
  kind,
  caseId: kind === "link" ? caseId : undefined,
  baseAlertVersion: alert.version,
  baseStatus: alert.status,
  baseCaseId: alert.caseId,
  title: alert.title,
});

export interface CreateBatchInput {
  caseId: string;
  alerts: Alert[];
  kind: TriageAction["kind"];
  evidenceDraft?: TriageEvidenceDraft;
}

/** 新建批次：每条动作在加入时即记录版本号；目标案件同样记录版本快照。 */
export const createTriageBatch = (input: CreateBatchInput): TriageBatch => {
  const database = readDatabase();
  const targetCase = database.cases.find((item) => item.id === input.caseId);
  if (!targetCase) {
    throw new Error("目标案件不存在");
  }
  const timestamp = nowIso();
  const batch: TriageBatch = {
    id: createId("BATCH"),
    caseId: input.caseId,
    caseBaseVersion: targetCase.version,
    caseBaseAlertIds: [...targetCase.alertIds],
    actions: input.alerts.map((alert) =>
      snapshotAction(alert, input.kind, input.caseId),
    ),
    evidenceDraft: input.evidenceDraft,
    status: "staging",
    actor: CURRENT_ACTOR,
    createdAt: timestamp,
    updatedAt: timestamp,
    conflicts: [],
    resolutions: {},
    attemptCount: 0,
  };
  saveQueue([...readTriageQueue(), batch]);
  setActiveBatchId(batch.id);
  return batch;
};

/** 向当前编辑中的批次追加动作（同告警同动作去重，重复加入刷新该动作版本快照）。 */
export const appendToBatch = (
  batchId: string,
  alerts: Alert[],
  kind: TriageAction["kind"],
  evidenceDraft?: TriageEvidenceDraft,
): TriageBatch => {
  const queue = readTriageQueue();
  const batch = queue.find((item) => item.id === batchId);
  if (!batch) {
    throw new Error("分诊批次不存在");
  }

  const incoming = alerts
    .map((alert) => snapshotAction(alert, kind, batch.caseId))
    .filter(
      (action) =>
        !batch.actions.some(
          (item) =>
            item.alertId === action.alertId && item.kind === action.kind,
        ),
    );

  const updated: TriageBatch = {
    ...batch,
    actions: [...batch.actions, ...incoming],
    evidenceDraft: evidenceDraft ?? batch.evidenceDraft,
    status: "staging",
    updatedAt: nowIso(),
    // 案件版本快照在建批时冻结，追加动作不刷新，避免掩盖并发冲突
  };
  saveQueue(queue.map((item) => (item.id === batchId ? updated : item)));
  return updated;
};

export const updateBatchEvidence = (
  batchId: string,
  draft: TriageEvidenceDraft | undefined,
): void => {
  const queue = readTriageQueue();
  saveQueue(
    queue.map((item) =>
      item.id === batchId
        ? { ...item, evidenceDraft: draft, updatedAt: nowIso() }
        : item,
    ),
  );
};

export const removeBatchAction = (
  batchId: string,
  alertId: string,
): void => {
  const queue = readTriageQueue();
  saveQueue(
    queue.map((item) =>
      item.id === batchId
        ? {
            ...item,
            actions: item.actions.filter(
              (action) => action.alertId !== alertId,
            ),
            updatedAt: nowIso(),
          }
        : item,
    ),
  );
};

export const setBatchResolution = (
  batchId: string,
  key: string,
  choice: "mine" | "theirs",
): void => {
  const queue = readTriageQueue();
  saveQueue(
    queue.map((item) =>
      item.id === batchId
        ? {
            ...item,
            resolutions: { ...item.resolutions, [key]: choice },
            updatedAt: nowIso(),
          }
        : item,
    ),
  );
};

export const discardBatch = (batchId: string): void => {
  saveQueue(readTriageQueue().filter((item) => item.id !== batchId));
  if (getActiveBatchId() === batchId) {
    setActiveBatchId(undefined);
  }
};

export const setActiveBatch = (batchId: string): void => {
  setActiveBatchId(batchId);
};

export const getBatch = (batchId: string): TriageBatch | undefined =>
  readTriageQueue().find((item) => item.id === batchId);

/** 已提交批次在审计留痕展示后清理。 */
export const pruneCommittedBatches = (): void => {
  const queue = readTriageQueue();
  const remaining = queue.filter((item) => item.status !== "committed");
  if (remaining.length !== queue.length) {
    saveQueue(remaining);
    if (
      getActiveBatchId() &&
      !remaining.some((item) => item.id === getActiveBatchId())
    ) {
      setActiveBatchId(undefined);
    }
  }
};

/**
 * "全部采用对方最新数据"：本批次所有冲突项均按对方版本处理，
 * 冲突涉及的动作不再改写（从批次剔除）；若批次因此变空则标记已提交（零写入）。
 */
export const refreshBatchSnapshots = (batchId: string): void => {
  const queue = readTriageQueue();
  const batch = queue.find((item) => item.id === batchId);
  if (!batch) {
    return;
  }
  const database = readDatabase();
  const targetCase = database.cases.find((item) => item.id === batch.caseId);
  const actions = batch.actions
    .filter(
      (action) =>
        // 该动作命中任意冲突即视为对方已处理，不再随批次写入
        !batch.conflicts.some((item) =>
          item.actionAlertIds.includes(action.alertId),
        ),
    )
    .map((action) => {
      const alert = database.alerts.find((item) => item.id === action.alertId);
      return alert
        ? {
            ...action,
            baseAlertVersion: alert.version,
            baseStatus: alert.status,
            baseCaseId: alert.caseId,
          }
        : action;
    })
    .filter((action) =>
      database.alerts.some((item) => item.id === action.alertId),
    );
  const timestamp = nowIso();
  saveQueue(
    queue.map((item) =>
      item.id === batchId
        ? {
            ...item,
            actions,
            caseBaseVersion: targetCase ? targetCase.version : item.caseBaseVersion,
            caseBaseAlertIds: targetCase
              ? [...targetCase.alertIds]
              : item.caseBaseAlertIds,
            conflicts: [],
            resolutions: {},
            status: actions.length > 0 ? ("staging" as const) : ("committed" as const),
            updatedAt: timestamp,
            ...(actions.length === 0
              ? { committedAt: timestamp, appliedAlertIds: [] }
              : {}),
          }
        : item,
    ),
  );
};
