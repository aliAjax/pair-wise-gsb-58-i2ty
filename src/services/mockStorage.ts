import {
  seedAlerts,
  seedAuditLogs,
  seedCases,
  seedConclusions,
  seedEdges,
  seedEvidence,
  seedNodes,
} from "../data/seed";
import type {
  Alert,
  AuditLog,
  ConclusionVersion,
  Evidence,
  InvestigationCase,
  InvestigationEdge,
  InvestigationNode,
  TriageBatch,
} from "../models/types";

export interface MockDatabase {
  alerts: Alert[];
  cases: InvestigationCase[];
  nodes: InvestigationNode[];
  edges: InvestigationEdge[];
  evidence: Evidence[];
  conclusions: ConclusionVersion[];
  auditLogs: AuditLog[];
}

const STORAGE_KEY = "bank-fraud-investigation-db-v1";
/** 待恢复的分诊批次（独立于业务库，业务库写入失败也不会丢批次）。 */
export const TRIAGE_QUEUE_KEY = "bank-fraud-investigation-triage-v1";
/** 演示用故障注入开关：置位后下一次事务提交在落库前失败。 */
export const FAIL_NEXT_COMMIT_KEY = "bank-fraud-investigation-fail-next-commit";

const createSeedDatabase = (): MockDatabase => ({
  alerts: structuredClone(seedAlerts),
  cases: structuredClone(seedCases),
  nodes: structuredClone(seedNodes),
  edges: structuredClone(seedEdges),
  evidence: structuredClone(seedEvidence),
  conclusions: structuredClone(seedConclusions),
  auditLogs: structuredClone(seedAuditLogs),
});

/** 为旧版本演示数据补齐乐观锁版本号。 */
const migrate = (database: MockDatabase): MockDatabase => {
  let changed = false;
  database.alerts = database.alerts.map((item) => {
    if (typeof item.version === "number") {
      return item;
    }
    changed = true;
    return { ...item, version: 1 };
  });
  database.cases = database.cases.map((item) => {
    if (typeof item.version === "number") {
      return item;
    }
    changed = true;
    return { ...item, version: 1 };
  });
  if (changed) {
    writeDatabase(database);
  }
  return database;
};

export const readDatabase = (): MockDatabase => {
  if (typeof window === "undefined") {
    return createSeedDatabase();
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const seeded = createSeedDatabase();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  try {
    return migrate(JSON.parse(stored) as MockDatabase);
  } catch {
    const seeded = createSeedDatabase();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
};

export const writeDatabase = (database: MockDatabase): void => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  }
};

/**
 * 原子提交：调用方在传入的数据库对象上完成全部变更（告警、案件、证据、
 * 审计），这里一次性序列化落库。落库前可注入故障，此时不写入任何内容，
 * 调用方据此把整批保留为待重试，避免半成品。
 */
export const commitDatabase = (database: MockDatabase): void => {
  if (typeof window === "undefined") {
    return;
  }
  if (window.localStorage.getItem(FAIL_NEXT_COMMIT_KEY) === "1") {
    window.localStorage.removeItem(FAIL_NEXT_COMMIT_KEY);
    throw new Error("本地事务写入失败（模拟存储故障），整批已保留为待重试。");
  }
  writeDatabase(database);
};

export const armNextCommitFailure = (): void => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(FAIL_NEXT_COMMIT_KEY, "1");
  }
};

export const readTriageQueue = (): TriageBatch[] => {
  if (typeof window === "undefined") {
    return [];
  }
  const stored = window.localStorage.getItem(TRIAGE_QUEUE_KEY);
  if (!stored) {
    return [];
  }
  try {
    return JSON.parse(stored) as TriageBatch[];
  } catch {
    return [];
  }
};

export const writeTriageQueue = (queue: TriageBatch[]): void => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TRIAGE_QUEUE_KEY, JSON.stringify(queue));
  }
};

export const resetDatabase = (): MockDatabase => {
  const seeded = createSeedDatabase();
  writeDatabase(seeded);
  window.localStorage.removeItem(TRIAGE_QUEUE_KEY);
  window.localStorage.removeItem(FAIL_NEXT_COMMIT_KEY);
  window.localStorage.removeItem("bank-fraud-investigation-active-triage-batch");
  return seeded;
};

export const createId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const nowIso = (): string => new Date().toISOString();

export const appendAudit = (
  database: MockDatabase,
  log: Omit<AuditLog, "id" | "at">,
): void => {
  database.auditLogs.unshift({
    id: createId("LOG"),
    at: nowIso(),
    ...log,
  });
};
