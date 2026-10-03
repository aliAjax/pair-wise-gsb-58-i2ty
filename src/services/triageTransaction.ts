import type {
  AlertStatus,
  TriageBatch,
  TriageConflictItem,
  TriageOperation,
} from "../models/types";
import {
  appendAudit,
  createId,
  nowIso,
  readDatabase,
  writeDatabase,
  type MockDatabase,
} from "./mockStorage";

const alertStatusLabels: Record<AlertStatus, string> = {
  new: "待分诊",
  triage: "研判中",
  linked: "已关联案件",
  dismissed: "已排除",
};

export interface CommitOptions {
  /** 冲突解决「保留本批次」时跳过版本号核对，直接以本批次内容覆盖。 */
  force?: boolean;
  /** 演示用：让落库动作抛错，验证整批保留为待重试且不产生半成品。 */
  failWrite?: boolean;
}

export type TriageTransactionOutcome =
  | { ok: true }
  | { ok: false; reason: "conflict"; conflicts: TriageConflictItem[] }
  | { ok: false; reason: "write_failed"; message: string };

const describeAlert = (database: MockDatabase, alertId: string): string => {
  const alert = database.alerts.find((item) => item.id === alertId);
  if (!alert) {
    return "告警已不存在";
  }
  const linked = alert.caseId ? `，关联 ${alert.caseId}` : "，未关联案件";
  return `状态「${alertStatusLabels[alert.status]}」${linked}，当前 v${alert.version}`;
};

const describeCase = (database: MockDatabase, caseId: string): string => {
  const targetCase = database.cases.find((item) => item.id === caseId);
  if (!targetCase) {
    return "案件已不存在";
  }
  return `告警清单 ${targetCase.alertIds.length} 条，更新于 ${new Date(targetCase.updatedAt).toLocaleString("zh-CN", { hour12: false })}，当前 v${targetCase.version}`;
};

// 阶段一：逐条核对操作携带的提交前版本号，任何一条不匹配都整批拒绝。
const validateOperations = (
  database: MockDatabase,
  batch: TriageBatch,
  force: boolean,
): TriageConflictItem[] => {
  const conflicts: TriageConflictItem[] = [];

  batch.operations.forEach((operation) => {
    if (
      operation.kind === "link_alert" ||
      operation.kind === "dismiss_alert"
    ) {
      const alertId = operation.alertId ?? "";
      const alert = database.alerts.find((item) => item.id === alertId);
      if (!alert) {
        conflicts.push({
          operationId: operation.id,
          target: "alert",
          targetId: alertId,
          expectedVersion: operation.baseAlertVersion ?? 0,
          currentVersion: -1,
          currentSummary: "告警已不存在",
        });
      } else if (!force && alert.version !== operation.baseAlertVersion) {
        conflicts.push({
          operationId: operation.id,
          target: "alert",
          targetId: alertId,
          expectedVersion: operation.baseAlertVersion ?? 0,
          currentVersion: alert.version,
          currentSummary: describeAlert(database, alertId),
        });
      }
    }

    if (
      operation.kind === "link_alert" ||
      operation.kind === "register_evidence"
    ) {
      const caseId = operation.caseId ?? "";
      const targetCase = database.cases.find((item) => item.id === caseId);
      if (!targetCase) {
        conflicts.push({
          operationId: operation.id,
          target: "case",
          targetId: caseId,
          expectedVersion: operation.baseCaseVersion ?? 0,
          currentVersion: -1,
          currentSummary: "案件已不存在",
        });
      } else if (!force && targetCase.version !== operation.baseCaseVersion) {
        conflicts.push({
          operationId: operation.id,
          target: "case",
          targetId: caseId,
          expectedVersion: operation.baseCaseVersion ?? 0,
          currentVersion: targetCase.version,
          currentSummary: describeCase(database, caseId),
        });
      }
    }
  });

  return conflicts;
};

// 阶段二：在内存副本上应用全部操作，告警、案件、证据一起变更。
const applyOperations = (
  database: MockDatabase,
  batch: TriageBatch,
): void => {
  const batchTag = `批次 ${batch.id}`;

  batch.operations.forEach((operation) => {
    if (operation.kind === "link_alert") {
      const alert = database.alerts.find((item) => item.id === operation.alertId);
      const targetCase = database.cases.find(
        (item) => item.id === operation.caseId,
      );
      if (!alert || !targetCase) {
        return;
      }
      alert.status = "linked";
      alert.caseId = targetCase.id;
      alert.version += 1;
      if (!targetCase.alertIds.includes(alert.id)) {
        targetCase.alertIds.push(alert.id);
      }
      targetCase.updatedAt = nowIso();
      targetCase.version += 1;
      appendAudit(database, {
        caseId: targetCase.id,
        actor: batch.createdBy,
        action: "批量关联告警",
        detail: `${batchTag}：告警 ${alert.id} 关联至本案并同步案件清单。`,
      });
      return;
    }

    if (operation.kind === "dismiss_alert") {
      const alert = database.alerts.find((item) => item.id === operation.alertId);
      if (!alert) {
        return;
      }
      alert.status = "dismissed";
      alert.version += 1;
      appendAudit(database, {
        caseId: alert.caseId,
        actor: batch.createdBy,
        action: "批量排除告警",
        detail: `${batchTag}：告警 ${alert.id} 标记为已排除。`,
      });
      return;
    }

    if (operation.kind === "register_evidence" && operation.evidenceDraft) {
      const targetCase = database.cases.find(
        (item) => item.id === operation.caseId,
      );
      if (!targetCase) {
        return;
      }
      database.evidence.unshift({
        ...operation.evidenceDraft,
        id: createId("EV"),
        caseId: targetCase.id,
        submittedAt: nowIso(),
        submittedBy: batch.createdBy,
        version: 1,
      });
      targetCase.updatedAt = nowIso();
      targetCase.version += 1;
      appendAudit(database, {
        caseId: targetCase.id,
        actor: batch.createdBy,
        action: "登记证据",
        detail: `${batchTag}：证据《${operation.evidenceDraft.title}》随批量分诊入库。`,
      });
    }
  });
};

/**
 * 批量分诊的本地事务：
 * 1. 逐条核对提交前记录的版本号（force 时跳过）；
 * 2. 全部匹配后在内存中一次性应用告警、案件、证据与审计；
 * 3. 单次落库，任何失败都不写库，调用方负责把整批保留为待重试。
 */
export const commitTriageBatchToDatabase = (
  batch: TriageBatch,
  options: CommitOptions = {},
): TriageTransactionOutcome => {
  const database = readDatabase();

  const conflicts = validateOperations(database, batch, options.force ?? false);
  if (conflicts.length > 0) {
    return { ok: false, reason: "conflict", conflicts };
  }

  applyOperations(database, batch);

  try {
    if (options.failWrite) {
      throw new Error("本地写入失败（模拟故障）");
    }
    writeDatabase(database);
  } catch (error) {
    return {
      ok: false,
      reason: "write_failed",
      message: error instanceof Error ? error.message : "本地写入失败",
    };
  }

  return { ok: true };
};

export const summarizeOperation = (operation: TriageOperation): string => {
  if (operation.kind === "link_alert") {
    return `关联告警 ${operation.alertId} → ${operation.caseId}`;
  }
  if (operation.kind === "dismiss_alert") {
    return `排除告警 ${operation.alertId}`;
  }
  return `登记证据《${operation.evidenceDraft?.title ?? "未命名"}》→ ${operation.caseId}`;
};
