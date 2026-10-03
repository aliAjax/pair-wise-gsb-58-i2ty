import {
  Alert,
  Badge,
  Button,
  Group,
  List,
  Paper,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Link2,
  EyeOff,
  History,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { InvestigationCase, TriageBatch } from "../../models/types";
import {
  useCommitTriageBatchMutation,
  useDiscardTriageBatchMutation,
  useRemoveTriageActionMutation,
} from "../../services/api";
import { ConflictResolutionPanel } from "./ConflictResolutionPanel";
import { EvidenceDraftForm } from "./EvidenceDraftForm";

const statusMeta: Record<
  TriageBatch["status"],
  { color: string; label: string }
> = {
  staging: { color: "blue", label: "编辑中" },
  pending_retry: { color: "red", label: "待重试（已保留）" },
  conflict: { color: "orange", label: "存在冲突" },
  committed: { color: "teal", label: "已入库" },
};

interface Props {
  batch: TriageBatch;
  investigationCase?: InvestigationCase;
  /** 是否为页面当前激活批次；已提交/历史批次以恢复入口形式展示。 */
  active?: boolean;
  onActivate?: () => void;
  onClearCommitted?: () => void;
}

export function TriageBatchPanel({
  batch,
  investigationCase,
  active = true,
  onActivate,
  onClearCommitted,
}: Props) {
  const [commitBatch, { isLoading: isCommitting }] =
    useCommitTriageBatchMutation();
  const [discardBatch] = useDiscardTriageBatchMutation();
  const [removeAction] = useRemoveTriageActionMutation();
  const [resultMessage, setResultMessage] = useState<string>();
  const meta = statusMeta[batch.status];

  const handleCommit = async () => {
    setResultMessage(undefined);
    try {
      const result = await commitBatch(batch.id).unwrap();
      if (result.status === "committed") {
        const applied = result.batch.appliedAlertIds?.length ?? 0;
        notifications.show({
          color: "teal",
          title: "事务已提交",
          message: `批次 ${result.batch.id} 整体入库，实际写入 ${applied} 条告警及对应案件/证据/审计。`,
        });
      } else if (result.status === "conflict") {
        notifications.show({
          color: "orange",
          title: "提交被冲突拦截",
          message: "业务库未写入任何内容，请在下方逐项选择保留版本。",
        });
      } else {
        notifications.show({
          color: "red",
          title: "写入失败，批次已保留",
          message: result.batch.lastError ?? "可稍后重试，整批数据不会丢失。",
        });
      }
    } catch (error) {
      const message =
        typeof error === "object" && error && "error" in error
          ? String(error.error)
          : "提交失败，请重试。";
      setResultMessage(message);
    }
  };

  const linkCount = batch.actions.filter((item) => item.kind === "link").length;
  const dismissCount = batch.actions.length - linkCount;

  const header = (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="sm">
        <ThemeIcon size="lg" radius="sm" color={meta.color} variant="light">
          {batch.status === "committed" ? (
            <CheckCircle2 size={18} />
          ) : batch.status === "pending_retry" ? (
            <AlertTriangle size={18} />
          ) : batch.status === "conflict" ? (
            <History size={18} />
          ) : (
            <Clock size={18} />
          )}
        </ThemeIcon>
        <div>
          <Group gap="xs">
            <Text size="sm" fw={700}>
              {active ? "当前分诊批次" : "待恢复批次"}
            </Text>
            <Badge color={meta.color} variant="light">
              {meta.label}
            </Badge>
            <Text size="xs" c="dimmed" ff="monospace">
              {batch.id}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            目标案件 {batch.caseId}
            {investigationCase ? ` · ${investigationCase.title}` : ""} · 建立于{" "}
            {new Date(batch.createdAt).toLocaleString("zh-CN", {
              hour12: false,
            })}{" "}
            · 第 {batch.attemptCount} 次提交尝试
          </Text>
        </div>
      </Group>
      {!active ? (
        <Button
          variant="light"
          size="xs"
          leftSection={<History size={14} />}
          onClick={onActivate}
        >
          恢复到当前处理
        </Button>
      ) : null}
    </Group>
  );

  if (batch.status === "committed") {
    return (
      <Paper withBorder p="md" bg="teal.0">
        {header}
        <Group justify="space-between" mt="sm">
          <Text size="sm">
            已实际入库 {batch.appliedAlertIds?.length ?? 0} 条告警
            {linkCount > 0 ? `、${linkCount} 条关联` : ""}
            {dismissCount > 0 ? `、${dismissCount} 条排除` : ""}
            {batch.evidenceDraft ? "及 1 条证据" : ""}，审计已同步留痕。
          </Text>
          <Button
            size="xs"
            variant="subtle"
            color="teal"
            onClick={onClearCommitted}
          >
            清除记录
          </Button>
        </Group>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        {header}

        {batch.status === "pending_retry" ? (
          <Alert color="red" icon={<AlertTriangle size={16} />}>
            <Text size="sm" fw={600}>
              上次提交写入失败，整批已原样保留
            </Text>
            <Text size="xs" mt={4}>
              {batch.lastError}
              。告警、案件、证据、审计均未留下半成品；网络或存储恢复后点击重试即可继续，关闭页面也不会丢失。
            </Text>
          </Alert>
        ) : null}

        <Group gap="xs">
          <Badge variant="light" color="teal" leftSection={<Link2 size={12} />}>
            关联 {linkCount}
          </Badge>
          <Badge variant="light" color="gray" leftSection={<EyeOff size={12} />}>
            排除 {dismissCount}
          </Badge>
          <Badge variant="outline" color="gray">
            案件基线 V{batch.caseBaseVersion}
          </Badge>
          {batch.evidenceDraft ? (
            <Badge variant="outline" color="teal">
              随批证据 1 条
            </Badge>
          ) : null}
        </Group>

        <Table.ScrollContainer minWidth={680}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>告警</Table.Th>
                <Table.Th>动作</Table.Th>
                <Table.Th>提交前版本</Table.Th>
                <Table.Th>提交时核对</Table.Th>
                {active && batch.status === "staging" ? (
                  <Table.Th w={80} />
                ) : null}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {batch.actions.map((action) => {
                const alertConflict = batch.conflicts.find(
                  (item) =>
                    item.entity === "alert" &&
                    item.actionAlertIds.includes(action.alertId),
                );
                const caseConflict = batch.conflicts.find(
                  (item) =>
                    item.entity === "case" &&
                    item.actionAlertIds.includes(action.alertId),
                );
                return (
                  <Table.Tr key={`${action.kind}-${action.alertId}`}>
                    <Table.Td>
                      <Text size="xs" fw={600}>
                        {action.title}
                      </Text>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {action.alertId}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {action.kind === "link" ? (
                        <Badge size="xs" color="teal" variant="light">
                          关联 {action.caseId}
                        </Badge>
                      ) : (
                        <Badge size="xs" color="gray" variant="light">
                          排除
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        V{action.baseAlertVersion}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {alertConflict || caseConflict ? (
                        <Text size="xs" c="orange">
                          版本冲突
                          {alertConflict
                            ? `（现为 V${alertConflict.currentVersion}）`
                            : "（受案件清单冲突影响）"}
                        </Text>
                      ) : batch.status === "committed" ? (
                        <Text size="xs" c="teal">
                          已写入
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed">
                          待提交核对
                        </Text>
                      )}
                    </Table.Td>
                    {active && batch.status === "staging" ? (
                      <Table.Td>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="gray"
                          onClick={() =>
                            void removeAction({
                              batchId: batch.id,
                              alertId: action.alertId,
                            })
                          }
                        >
                          移出
                        </Button>
                      </Table.Td>
                    ) : null}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        {active && batch.status !== "conflict" ? (
          <EvidenceDraftForm batch={batch} />
        ) : null}

        {active && batch.status === "conflict" ? (
          <ConflictResolutionPanel batch={batch} />
        ) : null}

        {resultMessage ? (
          <Alert color="red" title="提交失败">
            <List size="xs">
              <List.Item>{resultMessage}</List.Item>
            </List>
          </Alert>
        ) : null}

        {active ? (
          <Group justify="space-between">
            <Button
              variant="light"
              color="red"
              leftSection={<Trash2 size={15} />}
              onClick={() => {
                void discardBatch(batch.id);
                notifications.show({
                  color: "gray",
                  title: "批次已放弃",
                  message: "未提交的本地批次已删除，业务库不受影响。",
                });
              }}
            >
              放弃批次
            </Button>
            <Group>
              {batch.status === "pending_retry" ? (
                <Text size="xs" c="red">
                  可立即重试；批次及版本快照已持久化。
                </Text>
              ) : null}
              <Button
                leftSection={
                  batch.status === "pending_retry" ? (
                    <RefreshCw size={16} />
                  ) : undefined
                }
                loading={isCommitting}
                disabled={batch.actions.length === 0}
                onClick={handleCommit}
              >
                {batch.status === "pending_retry"
                  ? "重试整批提交"
                  : batch.status === "conflict"
                    ? "按选择重新提交"
                    : "提交事务"}
              </Button>
            </Group>
          </Group>
        ) : null}
      </Stack>
    </Paper>
  );
}
