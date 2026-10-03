import type {
  AuditLog,
  Evidence,
  TriageBatch,
  TriageConflict,
} from "../../models/types";
import {
  appendAudit,
  commitDatabase,
  createId,
  nowIso,
  readDatabase,
  readTriageQueue,
  writeTriageQueue,
  type MockDatabase,
} from "../../services/mockStorage";

const conflictKey = (conflict: TriageConflict): string =>
  `${conflict.entity}:${conflict.entityId}`;

const mineResult = (
  action: TriageBatch["actions"][number],
) => ({
  version: -1, // 成功提交后版本由引擎统一递增
  ...(action.kind === "link"
    ? { status: "linked" as const, caseId: action.caseId }
    : { status: "dismissed" as const, caseId: undefined }),
});

/**
 * 第一阶段：在内存数据库上核对版本，收集冲突。
 * 不做任何修改、不写任何存储，保证冲突时业务库完全不变。
 */
const detectConflicts = (
  database: MockDatabase,
  batch: TriageBatch,
): TriageConflict[] => {
  const conflicts: TriageConflict[] = [];

  // 1) 逐条核对告警版本
  batch.actions.forEach((action) => {
    const alert = database.alerts.find((item) => item.id === action.alertId);
    if (!alert) {
      conflicts.push({
        actionAlertIds: [action.alertId],
        entity: "alert",
        entityId: action.alertId,
        baseVersion: action.baseAlertVersion,
        currentVersion: -1,
        mine: mineResult(action),
        theirs: { version: -1 },
        label: `${action.title}（${action.alertId}）已不存在`,
      });
      return;
    }
    if (alert.version !== action.baseAlertVersion) {
      conflicts.push({
        actionAlertIds: [action.alertId],
        entity: "alert",
        entityId: alert.id,
        baseVersion: action.baseAlertVersion,
        currentVersion: alert.version,
        mine: mineResult(action),
        theirs: {
          version: alert.version,
          status: alert.status,
          caseId: alert.caseId,
        },
        label: `${action.title}（${alert.id}）`,
      });
    }
  });

  // 2) 核对目标案件版本（仅 link 动作会改案件清单）
  const linkActions = batch.actions.filter((item) => item.kind === "link");
  if (linkActions.length > 0) {
    const targetCase = database.cases.find((item) => item.id === batch.caseId);
    if (targetCase) {
      if (targetCase.version !== batch.caseBaseVersion) {
        const incomingIds = linkActions.map((item) => item.alertId);
        conflicts.push({
          actionAlertIds: incomingIds,
          entity: "case",
          entityId: targetCase.id,
          baseVersion: batch.caseBaseVersion,
          currentVersion: targetCase.version,
          mine: {
            version: -1,
            // 保留我的清单与本批关联，并并入对方窗口已新增的关联（并集，不删对方数据）
            alertIds: Array.from(
              new Set([
                ...batch.caseBaseAlertIds,
                ...incomingIds,
                ...targetCase.alertIds,
              ]),
            ),
          },
          theirs: {
            version: targetCase.version,
            alertIds: [...targetCase.alertIds],
            updatedAt: targetCase.updatedAt,
          },
          label: `${targetCase.title}（${targetCase.id}）的告警清单`,
        });
      }
    } else {
      conflicts.push({
        actionAlertIds: linkActions.map((item) => item.alertId),
        entity: "case",
        entityId: batch.caseId,
        baseVersion: batch.caseBaseVersion,
        currentVersion: -1,
        mine: { version: -1 },
        theirs: { version: -1 },
        label: `目标案件 ${batch.caseId} 已不存在`,
      });
    }
  }

  return conflicts;
};

const resolveAction = (
  batch: TriageBatch,
  conflicts: TriageConflict[],
  alertId: string,
): "apply" | "skip" => {
  const alertConflict = conflicts.find(
    (item) => item.entity === "alert" && item.actionAlertIds.includes(alertId),
  );
  if (alertConflict) {
    if (alertConflict.currentVersion === -1) {
      return "skip"; // 告警已删除，无法写入
    }
    return batch.resolutions[conflictKey(alertConflict)] === "mine"
      ? "apply"
      : "skip";
  }
  const caseConflict = conflicts.find(
    (item) =>
      item.entity === "case" && item.actionAlertIds.includes(alertId),
  );
  if (caseConflict) {
    return batch.resolutions[conflictKey(caseConflict)] === "mine"
      ? "apply"
      : "skip";
  }
  return "apply";
};

export interface CommitResult {
  status: "committed" | "conflict" | "failed";
  batch: TriageBatch;
}

/**
 * 提交一个分诊批次：
 * - 告警、案件、证据、审计在同一内存对象上完成，commitDatabase 一次性落库；
 * - 版本逐条核对，发现并发修改则整批不入库、转为冲突，由调查员选择版本；
 * - 落库失败则整批保留为待重试；
 * - 审计只记录实际入库的动作。
 */
export const commitTriageBatch = (batchId: string): CommitResult => {
  const queue = readTriageQueue();
  const batch = queue.find((item) => item.id === batchId);
  if (!batch) {
    throw new Error("分诊批次不存在");
  }

  const database = readDatabase();

  // ---- 阶段一：版本核对（无副作用）----
  const conflicts = detectConflicts(database, batch);
  const unresolved = conflicts.filter(
    (item) =>
      item.currentVersion !== -1 && !batch.resolutions[conflictKey(item)],
  );
  if (unresolved.length > 0) {
    const updated: TriageBatch = {
      ...batch,
      status: "conflict",
      conflicts,
      updatedAt: nowIso(),
      attemptCount: batch.attemptCount + 1,
    };
    writeTriageQueue(
      queue.map((item) => (item.id === batchId ? updated : item)),
    );
    return { status: "conflict", batch: updated };
  }

  // ---- 阶段二：按解决结果在内存对象上应用变更 ----
  const appliedActionKinds = { link: 0, dismiss: 0 };
  const appliedAlertIds: string[] = [];
  /** dismiss 时从其他案件清单摘掉告警，逐案件记审计。 */
  const removedFromCases: string[] = [];
  let caseMutated = false;

  const targetCase = database.cases.find((item) => item.id === batch.caseId);

  batch.actions.forEach((action) => {
    const decision = resolveAction(batch, conflicts, action.alertId);
    if (decision !== "apply") {
      return;
    }
    const alert = database.alerts.find((item) => item.id === action.alertId);
    if (!alert) {
      return;
    }
    if (action.kind === "link" && targetCase) {
      alert.status = "linked";
      alert.caseId = batch.caseId;
      if (!targetCase.alertIds.includes(alert.id)) {
        targetCase.alertIds.push(alert.id);
      }
      caseMutated = true;
      appliedActionKinds.link += 1;
    } else if (action.kind === "dismiss") {
      alert.status = "dismissed";
      alert.caseId = undefined;
      // 若该告警原本挂在某案件清单中，同步摘掉，保证清单与告警归属一致
      database.cases.forEach((item) => {
        if (item.alertIds.includes(alert.id)) {
          item.alertIds = item.alertIds.filter((id) => id !== alert.id);
          item.version += 1;
          item.updatedAt = nowIso();
          caseMutated = true;
          if (!removedFromCases.includes(item.id)) {
            removedFromCases.push(item.id);
          }
        }
      });
      appliedActionKinds.dismiss += 1;
    }
    alert.version += 1;
    appliedAlertIds.push(alert.id);
  });

  // 案件冲突选择"我的版本"：以我加入批次时的清单 + 本批 link 为准，
  // 同时保留对方窗口新增的关联（我并未要求删除它们），形成并集
  const caseConflict = conflicts.find((item) => item.entity === "case");
  if (
    caseConflict &&
    batch.resolutions[conflictKey(caseConflict)] === "mine" &&
    targetCase
  ) {
    const incomingIds = batch.actions
      .filter(
        (item) =>
          item.kind === "link" &&
          resolveAction(batch, conflicts, item.alertId) === "apply",
      )
      .map((item) => item.alertId);
    targetCase.alertIds = Array.from(
      new Set([
        ...batch.caseBaseAlertIds,
        ...incomingIds,
        ...caseConflict.theirs.alertIds!,
      ]),
    );
    caseMutated = true;
  }

  // 证据：只有存在实际入库的 link 动作时才与批次一起写入
  let evidence: Evidence | undefined;
  if (batch.evidenceDraft && appliedActionKinds.link > 0 && targetCase) {
    evidence = {
      id: createId("EV"),
      caseId: batch.caseId,
      ...batch.evidenceDraft,
      submittedAt: nowIso(),
      submittedBy: batch.actor,
      version: 1,
    };
    database.evidence.unshift(evidence);
    caseMutated = true;
  }

  if (caseMutated && targetCase) {
    targetCase.updatedAt = nowIso();
    targetCase.version += 1;
  }

  // ---- 审计：仅记录实际入库动作，随事务一起落库 ----
  const auditLogs: Array<Omit<AuditLog, "id" | "at">> = [];
  if (appliedActionKinds.link > 0) {
    auditLogs.push({
      caseId: batch.caseId,
      actor: batch.actor,
      action: "批量关联告警",
      detail: `事务 ${batch.id} 关联告警 ${batch.actions
        .filter(
          (item) =>
            item.kind === "link" &&
            resolveAction(batch, conflicts, item.alertId) === "apply",
        )
        .map((item) => item.alertId)
        .join("、")}。`,
    });
  }
  if (appliedActionKinds.dismiss > 0) {
    auditLogs.push({
      actor: batch.actor,
      action: "批量排除告警",
      detail: `事务 ${batch.id} 排除告警 ${batch.actions
        .filter(
          (item) =>
            item.kind === "dismiss" &&
            resolveAction(batch, conflicts, item.alertId) === "apply",
        )
        .map((item) => item.alertId)
        .join("、")}。`,
    });
  }
  if (evidence) {
    auditLogs.push({
      caseId: batch.caseId,
      actor: batch.actor,
      action: "新增证据",
      detail: `${evidence.title} 随分诊事务 ${batch.id} 一并登记，来源为 ${evidence.source}。`,
    });
  }
  removedFromCases
    .filter((caseId) => caseId !== batch.caseId)
    .forEach((caseId) => {
      auditLogs.push({
        caseId,
        actor: batch.actor,
        action: "移除案件告警",
        detail: `分诊事务 ${batch.id} 排除告警时，同步从案件清单移除以保持归属一致。`,
      });
    });
  auditLogs.forEach((log) => appendAudit(database, log));

  // ---- 阶段三：一次落库；失败则业务库不变，整批保留待重试 ----
  try {
    commitDatabase(database);
  } catch (error) {
    const updated: TriageBatch = {
      ...batch,
      status: "pending_retry",
      conflicts: [],
      lastError: error instanceof Error ? error.message : "写入失败",
      updatedAt: nowIso(),
      attemptCount: batch.attemptCount + 1,
    };
    writeTriageQueue(
      queue.map((item) => (item.id === batchId ? updated : item)),
    );
    return { status: "failed", batch: updated };
  }

  // ---- 成功：记录已提交版本快照，批次保留用于页面展示与审计追溯 ----
  const refreshedConflicts = conflicts.map((item) => {
    if (item.entity === "alert") {
      const latest = database.alerts.find((alert) => alert.id === item.entityId);
      return latest
        ? {
            ...item,
            mine: { ...item.mine, version: latest.version },
          }
        : item;
    }
    const latestCase = database.cases.find((c) => c.id === item.entityId);
    return latestCase
      ? { ...item, mine: { ...item.mine, version: latestCase.version } }
      : item;
  });

  const committed: TriageBatch = {
    ...batch,
    status: "committed",
    conflicts: refreshedConflicts,
    committedAt: nowIso(),
    updatedAt: nowIso(),
    lastError: undefined,
    appliedAlertIds,
  } as TriageBatch;
  writeTriageQueue(
    queue.map((item) => (item.id === batchId ? committed : item)),
  );
  return { status: "committed", batch: committed };
};

/** 供 UI 预演：返回当前数据库版本核对结果而不写入。 */
export const previewConflicts = (batch: TriageBatch): TriageConflict[] =>
  detectConflicts(readDatabase(), batch);
