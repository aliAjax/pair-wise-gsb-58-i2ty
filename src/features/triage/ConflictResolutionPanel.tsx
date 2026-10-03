import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  Radio,
  Stack,
  Text,
} from "@mantine/core";
import { GitMerge, ShieldAlert } from "lucide-react";
import type { TriageBatch, TriageConflict } from "../../models/types";
import { AlertStatusBadge } from "../../components/Badges";
import {
  useAdoptTriageSnapshotMutation,
  useResolveTriageConflictMutation,
} from "../../services/api";

const conflictEntityKey = (conflict: TriageConflict): string =>
  `${conflict.entity}:${conflict.entityId}`;

const formatIds = (ids?: string[]): string =>
  ids && ids.length > 0 ? ids.join("、") : "（空清单）";

function SnapshotBlock({
  title,
  color,
  conflict,
  side,
}: {
  title: string;
  color: string;
  conflict: TriageConflict;
  side: "mine" | "theirs";
}) {
  const snapshot = side === "mine" ? conflict.mine : conflict.theirs;
  return (
    <Paper withBorder p="sm" style={{ flex: 1 }} bg={`${color}.0`}>
      <Group justify="space-between" mb={6}>
        <Text size="sm" fw={600} c={`${color}.8`}>
          {title}
        </Text>
        <Badge size="xs" variant="light" color={color}>
          V{snapshot.version === -1 ? "待写入" : snapshot.version}
        </Badge>
      </Group>
      {snapshot.status ? (
        <Group gap="xs" mb={4}>
          <Text size="xs" c="dimmed">
            告警状态
          </Text>
          <AlertStatusBadge value={snapshot.status} />
          <Text size="xs" c="dimmed">
            {snapshot.caseId ? `归属 ${snapshot.caseId}` : "未关联案件"}
          </Text>
        </Group>
      ) : null}
      {snapshot.alertIds ? (
        <Stack gap={2}>
          <Text size="xs" c="dimmed">
            案件告警清单
          </Text>
          <Text size="xs" ff="monospace" style={{ wordBreak: "break-all" }}>
            {formatIds(snapshot.alertIds)}
          </Text>
        </Stack>
      ) : null}
      {snapshot.updatedAt ? (
        <Text size="xs" c="dimmed" mt={4}>
          更新于{" "}
          {new Date(snapshot.updatedAt).toLocaleString("zh-CN", {
            hour12: false,
          })}
        </Text>
      ) : null}
    </Paper>
  );
}

interface Props {
  batch: TriageBatch;
}

/**
 * 后到批次在提交时发现版本不一致：业务库完全未写入，
 * 由调查员逐项选择保留自己的版本还是对方窗口已提交的版本。
 */
export function ConflictResolutionPanel({ batch }: Props) {
  const [resolve, { isLoading: isResolving }] =
    useResolveTriageConflictMutation();
  const [adopt, { isLoading: isAdopting }] =
    useAdoptTriageSnapshotMutation();

  const resolvable = batch.conflicts.filter(
    (item) => item.currentVersion !== -1,
  );
  const missing = batch.conflicts.filter(
    (item) => item.currentVersion === -1,
  );
  const allResolved =
    resolvable.length > 0 &&
    resolvable.every((item) => batch.resolutions[conflictEntityKey(item)]);

  return (
    <Alert
      color="orange"
      icon={<ShieldAlert size={18} />}
      title="检测到并发修改冲突"
      mt="md"
    >
      <Stack gap="md">
        <Text size="sm">
          另一窗口已在本批次暂存后提交了相同案件或告警（版本由{" "}
          {resolvable[0]?.baseVersion ?? "?"} 变为{" "}
          {resolvable[0]?.currentVersion ?? "?"}）。本批次尚未写入任何数据，请逐项选择保留哪一版后重新提交。
        </Text>

        {missing.length > 0 ? (
          <Paper withBorder p="sm" bg="gray.0">
            <Text size="sm" fw={600} mb={4}>
              已失效动作（将自动跳过，不写入）
            </Text>
            {missing.map((item) => (
              <Text key={`${item.entity}-${item.entityId}`} size="xs" c="dimmed">
                {item.label}
              </Text>
            ))}
          </Paper>
        ) : null}

        {resolvable.map((conflict) => {
          const key = conflictEntityKey(conflict);
          const choice = batch.resolutions[key];
          return (
            <Paper key={key} withBorder p="md">
              <Group justify="space-between" mb="sm">
                <Group gap="xs">
                  <GitMerge size={16} />
                  <Text size="sm" fw={600}>
                    {conflict.label}
                  </Text>
                  <Badge size="xs" variant="outline">
                    {conflict.entity === "case" ? "案件版本" : "告警版本"}
                  </Badge>
                </Group>
                {choice ? (
                  <Badge color={choice === "mine" ? "teal" : "gray"} size="sm">
                    {choice === "mine" ? "保留我的版本" : "采用对方版本"}
                  </Badge>
                ) : null}
              </Group>
              <Group align="stretch" grow gap="sm">
                <SnapshotBlock
                  title="我的批次（本窗口暂存）"
                  color="teal"
                  conflict={conflict}
                  side="mine"
                />
                <SnapshotBlock
                  title="对方版本（另一窗口已提交）"
                  color="gray"
                  conflict={conflict}
                  side="theirs"
                />
              </Group>
              <Radio.Group
                mt="sm"
                value={choice ?? ""}
                onChange={(value) =>
                  void resolve({
                    batchId: batch.id,
                    conflictKey: key,
                    choice: value as "mine" | "theirs",
                  })
                }
              >
                <Group>
                  <Radio value="mine" label="保留我的版本（覆盖对方）" />
                  <Radio value="theirs" label="采用对方版本（跳过我的相关动作）" />
                </Group>
              </Radio.Group>
              <Divider my="sm" />
              <Text size="xs" c="dimmed">
                {conflict.entity === "case"
                  ? "选择对方版本时，本批针对该案件的关联动作将全部跳过；选择我的版本时，保留我暂存时的清单和本批关联，并把对方窗口新增的关联并入（不会删除对方已加入的告警）。"
                  : "选择对方版本时跳过此告警动作；选择我的版本时按本批次的状态与归属强制写入并再次递增版本。"}
              </Text>
            </Paper>
          );
        })}

        <Group>
          <Button
            variant="light"
            color="gray"
            loading={isAdopting}
            onClick={() => void adopt(batch.id)}
          >
            全部采用对方版本（冲突动作移出批次）
          </Button>
          {isResolving ? (
            <Text size="xs" c="dimmed">
              正在保存选择...
            </Text>
          ) : null}
          {!allResolved ? (
            <Text size="xs" c="orange">
              还有未选择保留版本的冲突项。
            </Text>
          ) : null}
        </Group>
      </Stack>
    </Alert>
  );
}
