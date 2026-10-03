import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  AlertTriangle,
  FilePlus2,
  GitPullRequestArrow,
  History,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useAppSelector } from "../../app/hooks";
import type {
  EvidenceStrength,
  TriageBatch,
  TriageOperation,
} from "../../models/types";
import {
  useCommitTriageBatchMutation,
  useDiscardTriageBatchMutation,
  useGetTriageBatchesQuery,
  useResolveTriageConflictMutation,
  useSaveTriageDraftMutation,
  type CommitBatchResult,
} from "../../services/api";
import { createId, nowIso } from "../../services/mockStorage";
import { summarizeOperation } from "../../services/triageTransaction";

const CURRENT_ACTOR = "林澜";

const operationKindLabels: Record<TriageOperation["kind"], string> = {
  link_alert: "关联案件",
  dismiss_alert: "排除告警",
  register_evidence: "登记证据",
};

const describeBaseVersion = (operation: TriageOperation): string => {
  const parts: string[] = [];
  if (typeof operation.baseAlertVersion === "number") {
    parts.push(`告警 v${operation.baseAlertVersion}`);
  }
  if (typeof operation.baseCaseVersion === "number") {
    parts.push(`案件 v${operation.baseCaseVersion}`);
  }
  return parts.length > 0 ? parts.join(" / ") : "—";
};

const notifyCommitResult = (result: CommitBatchResult) => {
  if (result.status === "committed") {
    notifications.show({
      color: "teal",
      title: "批次已入库",
      message: `批次 ${result.batchId} 的告警、案件、证据与审计已一起写入。`,
    });
    return;
  }
  if (result.status === "conflict") {
    notifications.show({
      color: "orange",
      title: "检测到版本冲突",
      message: "线上数据已被其他窗口修改，请在冲突列表中选择保留哪一版。",
    });
    return;
  }
  if (result.status === "pending_retry") {
    notifications.show({
      color: "red",
      title: "写入失败，整批已保留为待重试",
      message: `${result.message}。未留下半成品数据，可直接重试。`,
    });
    return;
  }
  notifications.show({
    color: "gray",
    title: "批次已放弃",
    message: "未写入任何数据，线上版本保持不变。",
  });
};

export function TriageBatchPanel() {
  const caseTargetId = useAppSelector((state) => state.alertsUi.caseTargetId);
  const { data: batches = [] } = useGetTriageBatchesQuery();
  const [saveDraft] = useSaveTriageDraftMutation();
  const [commitBatch, { isLoading: isCommitting }] =
    useCommitTriageBatchMutation();
  const [resolveConflict, { isLoading: isResolving }] =
    useResolveTriageConflictMutation();
  const [discardBatch] = useDiscardTriageBatchMutation();

  const [simulateFailure, setSimulateFailure] = useState(false);
  const [evidenceOpened, evidenceToggle] = useDisclosure(false);
  const [evidenceForm, setEvidenceForm] = useState({
    title: "",
    source: "",
    strength: "medium" as EvidenceStrength,
    occurredAt: new Date().toISOString().slice(0, 16),
    attachment: "",
    note: "",
  });

  const draft = batches.find((item) => item.status === "draft");
  const retryBatches = batches.filter((item) => item.status === "pending_retry");
  const conflictBatches = batches.filter((item) => item.status === "conflict");

  const persistDraft = async (next: TriageBatch) => {
    if (next.operations.length === 0) {
      await discardBatch(next.id).unwrap();
      return;
    }
    await saveDraft({ ...next, updatedAt: nowIso() }).unwrap();
  };

  const stageOperation = async (operation: TriageOperation) => {
    const base: TriageBatch =
      draft ?? {
        id: createId("BATCH"),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        createdBy: CURRENT_ACTOR,
        status: "draft",
        operations: [],
        conflicts: [],
      };
    await saveDraft({
      ...base,
      operations: [...base.operations, operation],
      updatedAt: nowIso(),
    }).unwrap();
  };

  const handleStageEvidence = async () => {
    if (!caseTargetId) {
      notifications.show({
        color: "red",
        title: "缺少目标案件",
        message: "请先在上方选择目标案件，再把证据登记加入批次。",
      });
      return;
    }
    if (
      !evidenceForm.title.trim() ||
      !evidenceForm.source.trim() ||
      !evidenceForm.attachment.trim()
    ) {
      notifications.show({
        color: "red",
        title: "信息不完整",
        message: "证据名称、来源和附件标识均为必填项。",
      });
      return;
    }
    await stageOperation({
      id: createId("OP"),
      kind: "register_evidence",
      caseId: caseTargetId,
      evidenceDraft: {
        title: evidenceForm.title.trim(),
        source: evidenceForm.source.trim(),
        strength: evidenceForm.strength,
        occurredAt: new Date(evidenceForm.occurredAt).toISOString(),
        attachment: evidenceForm.attachment.trim(),
        note: evidenceForm.note.trim() || "未补充说明。",
      },
    });
    notifications.show({
      color: "blue",
      title: "证据登记已加入批次",
      message: "提交批次时才会与告警、案件一起入库。",
    });
    setEvidenceForm((current) => ({
      ...current,
      title: "",
      source: "",
      attachment: "",
      note: "",
    }));
  };

  const handleCommit = async (batchId: string, withFault: boolean) => {
    try {
      const result = await commitBatch({
        batchId,
        simulateFailure: withFault,
      }).unwrap();
      notifyCommitResult(result);
    } catch (error) {
      notifications.show({
        color: "red",
        title: "提交失败",
        message:
          typeof error === "object" && error && "error" in error
            ? String(error.error)
            : "提交失败，请重试。",
      });
    }
  };

  const handleResolve = async (
    batchId: string,
    resolution: "keep_mine" | "keep_theirs",
  ) => {
    try {
      const result = await resolveConflict({ batchId, resolution }).unwrap();
      notifyCommitResult(result);
    } catch (error) {
      notifications.show({
        color: "red",
        title: "冲突处理失败",
        message:
          typeof error === "object" && error && "error" in error
            ? String(error.error)
            : "冲突处理失败，请重试。",
      });
    }
  };

  return (
    <Paper withBorder id="triage-batch-panel">
      <Group justify="space-between" p="md">
        <Group gap="sm">
          <ThemeIcon size={34} radius="sm" variant="light" color="teal">
            <GitPullRequestArrow size={18} />
          </ThemeIcon>
          <div>
            <Text fw={600}>批量分诊事务（本地可恢复）</Text>
            <Text size="xs" c="dimmed">
              操作先进入本地批次并记录提交前版本号；提交时逐条核对，告警、案件、证据与审计要么一起入库，要么整批保留待重试。
            </Text>
          </div>
        </Group>
        <Badge variant="light" color={draft?.operations.length ? "blue" : "gray"}>
          当前批次 {draft?.operations.length ?? 0} 条待提交
        </Badge>
      </Group>
      <Divider />

      {retryBatches.length > 0 || conflictBatches.length > 0 ? (
        <Stack gap="sm" p="md">
          {retryBatches.map((batch) => (
            <Alert
              key={batch.id}
              color="red"
              icon={<RefreshCw size={16} />}
              title={`待重试批次 ${batch.id}`}
            >
              <Stack gap="xs">
                <Text size="sm">
                  上次写入失败：{batch.lastError ?? "未知错误"}。整批{" "}
                  {batch.operations.length} 条操作已保留，未产生半成品数据。
                </Text>
                <Group>
                  <Button
                    size="compact-xs"
                    color="red"
                    loading={isCommitting}
                    onClick={() => handleCommit(batch.id, false)}
                  >
                    重试入库
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => void discardBatch(batch.id)}
                  >
                    放弃批次
                  </Button>
                </Group>
              </Stack>
            </Alert>
          ))}

          {conflictBatches.map((batch) => (
            <Alert
              key={batch.id}
              color="orange"
              icon={<AlertTriangle size={16} />}
              title={`冲突批次 ${batch.id}（${batch.operations.length} 条操作未入库）`}
            >
              <Stack gap="xs">
                <Text size="sm">
                  以下对象在提交前已被其他窗口修改，请核对线上版本后选择保留哪一版：
                </Text>
                <Table withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>对象</Table.Th>
                      <Table.Th>提交前版本</Table.Th>
                      <Table.Th>线上版本</Table.Th>
                      <Table.Th>线上当前状态</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {batch.conflicts.map((conflict) => (
                      <Table.Tr key={`${conflict.operationId}-${conflict.target}`}>
                        <Table.Td>
                          <Text size="xs" ff="monospace">
                            {conflict.target === "alert" ? "告警" : "案件"}{" "}
                            {conflict.targetId}
                          </Text>
                        </Table.Td>
                        <Table.Td>v{conflict.expectedVersion}</Table.Td>
                        <Table.Td>
                          {conflict.currentVersion >= 0
                            ? `v${conflict.currentVersion}`
                            : "已删除"}
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{conflict.currentSummary}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                <Group>
                  <Button
                    size="compact-xs"
                    color="orange"
                    loading={isResolving}
                    onClick={() => handleResolve(batch.id, "keep_mine")}
                  >
                    保留本批次并覆盖入库
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    loading={isResolving}
                    onClick={() => handleResolve(batch.id, "keep_theirs")}
                  >
                    保留线上版本，放弃本批次
                  </Button>
                </Group>
              </Stack>
            </Alert>
          ))}
        </Stack>
      ) : null}

      {draft ? (
        <Stack gap="sm" p="md">
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              当前批次 {draft.id} · {draft.createdBy} · 创建于{" "}
              {new Date(draft.createdAt).toLocaleString("zh-CN", {
                hour12: false,
              })}
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              leftSection={<Trash2 size={13} />}
              onClick={() => void discardBatch(draft.id)}
            >
              清空批次
            </Button>
          </Group>
          <Table withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>操作</Table.Th>
                <Table.Th>内容</Table.Th>
                <Table.Th>提交前版本</Table.Th>
                <Table.Th w={60} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {draft.operations.map((operation) => (
                <Table.Tr key={operation.id}>
                  <Table.Td>
                    <Badge variant="light" color="blue">
                      {operationKindLabels[operation.kind]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {summarizeOperation(operation)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{describeBaseVersion(operation)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="gray"
                      onClick={() =>
                        void persistDraft({
                          ...draft,
                          operations: draft.operations.filter(
                            (item) => item.id !== operation.id,
                          ),
                        })
                      }
                    >
                      移除
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          <Group justify="space-between" align="flex-end">
            <Group gap="sm">
              <Button
                variant="default"
                size="xs"
                leftSection={<FilePlus2 size={14} />}
                onClick={evidenceToggle.toggle}
              >
                {evidenceOpened ? "收起证据登记" : "附带登记证据"}
              </Button>
              <Checkbox
                size="xs"
                label="演示：模拟本次写入失败"
                checked={simulateFailure}
                onChange={(event) =>
                  setSimulateFailure(event.currentTarget.checked)
                }
              />
            </Group>
            <Button
              leftSection={<Send size={15} />}
              loading={isCommitting}
              disabled={draft.operations.length === 0}
              onClick={() => handleCommit(draft.id, simulateFailure)}
            >
              提交批次入库
            </Button>
          </Group>

          <Collapse expanded={evidenceOpened}>
            <Paper withBorder p="sm" bg="gray.0">
              <Text size="xs" c="dimmed" mb="xs">
                证据将登记到当前目标案件 {caseTargetId || "（未选择）"}
                ，并随批次一起入库。
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <TextInput
                  size="xs"
                  label="证据名称"
                  value={evidenceForm.title}
                  onChange={(event) =>
                    setEvidenceForm((current) => ({
                      ...current,
                      title: event.currentTarget.value,
                    }))
                  }
                />
                <TextInput
                  size="xs"
                  label="证据来源"
                  value={evidenceForm.source}
                  onChange={(event) =>
                    setEvidenceForm((current) => ({
                      ...current,
                      source: event.currentTarget.value,
                    }))
                  }
                />
                <Select
                  size="xs"
                  label="证据强度"
                  value={evidenceForm.strength}
                  onChange={(value) =>
                    setEvidenceForm((current) => ({
                      ...current,
                      strength: (value as EvidenceStrength) ?? "medium",
                    }))
                  }
                  data={[
                    { value: "strong", label: "强证据" },
                    { value: "medium", label: "中等证据" },
                    { value: "weak", label: "弱证据" },
                  ]}
                />
                <TextInput
                  size="xs"
                  label="附件标识"
                  value={evidenceForm.attachment}
                  onChange={(event) =>
                    setEvidenceForm((current) => ({
                      ...current,
                      attachment: event.currentTarget.value,
                    }))
                  }
                />
                <TextInput
                  size="xs"
                  type="datetime-local"
                  label="证据发生时间"
                  value={evidenceForm.occurredAt}
                  onChange={(event) =>
                    setEvidenceForm((current) => ({
                      ...current,
                      occurredAt: event.currentTarget.value,
                    }))
                  }
                />
              </SimpleGrid>
              <Textarea
                size="xs"
                label="证据说明"
                minRows={2}
                mt="xs"
                value={evidenceForm.note}
                onChange={(event) =>
                  setEvidenceForm((current) => ({
                    ...current,
                    note: event.currentTarget.value,
                  }))
                }
              />
              <Group justify="flex-end" mt="xs">
                <Button size="xs" variant="light" onClick={handleStageEvidence}>
                  加入批次
                </Button>
              </Group>
            </Paper>
          </Collapse>
        </Stack>
      ) : (
        <Group p="md" gap="sm">
          <History size={16} />
          <Text size="sm" c="dimmed">
            暂无进行中的批次。勾选告警后选择「加入关联批次」或「排除加入批次」，操作会保存在本地，关闭页面再打开仍可继续。
          </Text>
        </Group>
      )}
    </Paper>
  );
}
