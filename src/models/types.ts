export type RiskLevel = "high" | "medium" | "low";
export type AlertStatus = "new" | "triage" | "linked" | "dismissed";
export type CaseStatus =
  | "investigating"
  | "pending_review"
  | "supplement"
  | "closed";
export type EvidenceStrength = "strong" | "medium" | "weak";
export type NodeKind = "account" | "device" | "ip" | "merchant";
export type EdgeKind = "transfer" | "shared_device" | "shared_ip" | "payee";
export type CaseDisposition = "freeze" | "release" | "observe";
export type ConclusionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "returned";

export interface Alert {
  id: string;
  title: string;
  account: string;
  counterparty: string;
  channel: string;
  amount: number;
  riskLevel: RiskLevel;
  score: number;
  status: AlertStatus;
  detectedAt: string;
  tags: string[];
  deviceId: string;
  ip: string;
  caseId?: string;
  /** 乐观锁版本号：每次实际写入后递增，提交前快照核对。 */
  version: number;
}

export interface GraphNodeData {
  label: string;
  kind: NodeKind;
  riskLevel: RiskLevel;
  note: string;
  evidenceStrength: EvidenceStrength;
  source: string;
  occurredAt: string;
}

export interface InvestigationNode {
  id: string;
  caseId: string;
  position: { x: number; y: number };
  data: GraphNodeData;
}

export interface InvestigationEdge {
  id: string;
  caseId: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
  amount?: number;
  occurredAt: string;
  explanation: string;
}

export interface Evidence {
  id: string;
  caseId: string;
  title: string;
  source: string;
  strength: EvidenceStrength;
  occurredAt: string;
  submittedAt: string;
  submittedBy: string;
  attachment: string;
  note: string;
  version: number;
}

export interface ConclusionVersion {
  id: string;
  caseId: string;
  version: number;
  status: ConclusionStatus;
  disposition: CaseDisposition;
  rationale: string;
  riskControls: string[];
  createdBy: string;
  createdAt: string;
  reviewer: string;
  reviewerNote?: string;
}

export interface InvestigationCase {
  id: string;
  title: string;
  status: CaseStatus;
  riskLevel: RiskLevel;
  owner: string;
  openedAt: string;
  updatedAt: string;
  summary: string;
  alertIds: string[];
  nextReviewAt: string;
  /** 乐观锁版本号：告警清单等案件字段每次写入后递增。 */
  version: number;
}

export interface AuditLog {
  id: string;
  caseId?: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface AlertFilters {
  keyword: string;
  riskLevel: RiskLevel | "all";
  status: AlertStatus | "all";
  channel: string;
}

export interface CaseWorkspace {
  case: InvestigationCase;
  nodes: InvestigationNode[];
  edges: InvestigationEdge[];
  evidence: Evidence[];
  conclusions: ConclusionVersion[];
}

export interface DashboardSummary {
  newAlerts: number;
  highRiskAlerts: number;
  activeCases: number;
  pendingReview: number;
  totalExposure: number;
  caseStatusCounts: Record<CaseStatus, number>;
  riskCounts: Record<RiskLevel, number>;
}

/** 批量分诊中的单条动作，均带提交前记录的版本快照。 */
export type TriageActionKind = "link" | "dismiss";

export interface TriageAction {
  alertId: string;
  kind: TriageActionKind;
  /** link 动作的目标案件（dismiss 时为 undefined）。 */
  caseId?: string;
  /** 加入批次时记录的告警版本，提交时逐条核对。 */
  baseAlertVersion: number;
  /** 加入批次时告警的状态/案件归属，供冲突时还原"本批次依据"。 */
  baseStatus: AlertStatus;
  baseCaseId?: string;
  title: string;
}

/** 与批次一起提交的证据草稿，仅在批次实际入库时写入。 */
export interface TriageEvidenceDraft {
  title: string;
  source: string;
  strength: EvidenceStrength;
  occurredAt: string;
  attachment: string;
  note: string;
}

export type TriageBatchStatus =
  | "staging" // 编辑中，尚未提交
  | "pending_retry" // 提交时写入失败，整批保留待重试
  | "conflict" // 提交时发现版本冲突，等待调查员选择保留版本
  | "committed"; // 已整体入库

export interface ConflictSnapshot {
  version: number;
  status?: AlertStatus;
  caseId?: string;
  alertIds?: string[];
  updatedAt?: string;
}

export interface TriageConflict {
  /** 受影响的批次内动作；同一条案件冲突会关联多个 link 动作。 */
  actionAlertIds: string[];
  entity: "alert" | "case";
  entityId: string;
  /** 本批次加入时记录的版本（调查员看到的数据）。 */
  baseVersion: number;
  /** 提交时数据库中的实际版本（另一个窗口已写入）。 */
  currentVersion: number;
  /** 本批次希望写入的结果。 */
  mine: ConflictSnapshot;
  /** 另一个窗口已经写入的结果。 */
  theirs: ConflictSnapshot;
  /** 冲突实体的可读说明。 */
  label: string;
}

export interface TriageBatch {
  id: string;
  caseId: string;
  /** 加入批次时记录的目标案件版本与告警清单快照。 */
  caseBaseVersion: number;
  caseBaseAlertIds: string[];
  actions: TriageAction[];
  evidenceDraft?: TriageEvidenceDraft;
  status: TriageBatchStatus;
  actor: string;
  createdAt: string;
  updatedAt: string;
  committedAt?: string;
  lastError?: string;
  conflicts: TriageConflict[];
  /** 冲突解决结果：entity 键 -> 保留哪一版。 */
  resolutions: Record<string, "mine" | "theirs">;
  attemptCount: number;
  /** 成功提交时实际写入的告警。 */
  appliedAlertIds?: string[];
}
