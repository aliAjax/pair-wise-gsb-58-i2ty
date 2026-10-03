import {
  Badge,
  Button,
  Checkbox,
  Group,
  MultiSelect,
  NumberFormatter,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  EyeOff,
  History,
  Link2,
  RotateCcw,
  Search,
  Zap,
} from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertStatusBadge,
  RiskBadge,
} from "../components/Badges";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import {
  resetAlertFilters,
  setAlertFilters,
  setAlertSelection,
  setCaseTargetId,
} from "../features/alerts/alertsSlice";
import { TriageBatchPanel } from "../features/triage/TriageBatchPanel";
import {
  pruneCommittedBatches,
  setActiveBatch,
  useActiveBatchId,
  useTriageQueue,
} from "../features/triage/triageStore";
import {
  useArmCommitFailureMutation,
  useGetAlertsQuery,
  useGetCasesQuery,
  useStageTriageBatchMutation,
} from "../services/api";

export function AlertsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const filters = useAppSelector((state) => state.alertsUi.filters);
  const selectedIds = useAppSelector(
    (state) => state.alertsUi.selectedAlertIds,
  );
  const caseTargetId = useAppSelector((state) => state.alertsUi.caseTargetId);
  const { data: alerts = [], isFetching } = useGetAlertsQuery(filters);
  const { data: cases = [] } = useGetCasesQuery();
  const [stageBatch, { isLoading: isStaging }] = useStageTriageBatchMutation();
  const [armFailure, { isLoading: isArming }] =
    useArmCommitFailureMutation();

  const queue = useTriageQueue();
  const activeBatchId = useActiveBatchId();
  const activeBatch =
    queue.find((item) => item.id === activeBatchId && item.status !== "committed") ??
    queue.find((item) => item.status === "pending_retry") ??
    queue.find((item) => item.status === "conflict") ??
    queue.find((item) => item.status === "staging");
  const recoverableBatches = queue.filter(
    (item) => item.id !== activeBatch?.id && item.status !== "committed",
  );
  const committedBatches = queue.filter((item) => item.status === "committed");

  const allCurrentSelected =
    alerts.length > 0 && alerts.every((item) => selectedIds.includes(item.id));

  const channels = useMemo(
    () =>
      Array.from(new Set(alerts.map((item) => item.channel))).map((channel) => ({
        value: channel,
        label: channel,
      })),
    [alerts],
  );

  const caseById = useMemo(
    () => new Map(cases.map((item) => [item.id, item])),
    [cases],
  );

  const stage = async (kind: "link" | "dismiss") => {
    if (selectedIds.length === 0) {
      notifications.show({
        color: "red",
        title: "无法暂存",
        message: "请先勾选至少一条告警。",
      });
      return;
    }
    if (kind === "link" && !caseTargetId) {
      notifications.show({
        color: "red",
        title: "无法暂存",
        message: "请选择目标案件。",
      });
      return;
    }
    try {
      const reuse =
        activeBatch &&
        activeBatch.status === "staging" &&
        (kind === "dismiss" || activeBatch.caseId === caseTargetId);
      const result = await stageBatch({
        batchId: reuse ? activeBatch.id : undefined,
        caseId: kind === "link" ? caseTargetId : activeBatch?.caseId ?? caseTargetId,
        alertIds: selectedIds,
        kind,
      }).unwrap();
      notifications.show({
        color: "blue",
        title: "已加入本地事务批次",
        message: `${selectedIds.length} 条动作以版本快照加入 ${result.id}，尚未写入业务库。`,
      });
      dispatch(setAlertSelection([]));
    } catch (error) {
      const message =
        typeof error === "object" && error && "error" in error
          ? String(error.error)
          : "暂存失败，请重试。";
      notifications.show({ color: "red", title: "暂存失败", message });
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>告警中心</Title>
          <Text c="dimmed" size="sm" mt={4}>
            批量分诊为可恢复本地事务：动作带版本快照，提交时逐条核对；告警、案件、证据、审计一起入库。
          </Text>
        </div>
        <Group gap="lg">
          <Switch
            size="xs"
            color="red"
            disabled={isArming}
            onLabel={<Zap size={12} />}
            label={
              <Text size="xs" c="dimmed">
                模拟下次提交写入失败
              </Text>
            }
            onChange={(event) => {
              if (event.currentTarget.checked) {
                void armFailure();
                notifications.show({
                  color: "orange",
                  title: "故障注入已开启",
                  message: "下一次事务提交会在落库前失败，整批将保留为待重试。",
                });
              }
            }}
          />
          <Text size="sm" c="dimmed">
            {isFetching ? "正在刷新本地服务..." : `共 ${alerts.length} 条结果`}
          </Text>
        </Group>
      </Group>

      <Paper withBorder p="md">
        <Group align="flex-end" grow>
          <TextInput
            label="关键词"
            placeholder="告警编号、账户、设备、IP 或标签"
            leftSection={<Search size={16} />}
            value={filters.keyword}
            onChange={(event) =>
              dispatch(setAlertFilters({ keyword: event.currentTarget.value }))
            }
          />
          <Select
            label="风险等级"
            value={filters.riskLevel}
            onChange={(value) =>
              dispatch(
                setAlertFilters({
                  riskLevel:
                    (value as typeof filters.riskLevel | null) ?? "all",
                }),
              )
            }
            data={[
              { value: "all", label: "全部风险" },
              { value: "high", label: "高风险" },
              { value: "medium", label: "中风险" },
              { value: "low", label: "低风险" },
            ]}
          />
          <Select
            label="处置状态"
            value={filters.status}
            onChange={(value) =>
              dispatch(
                setAlertFilters({
                  status: (value as typeof filters.status | null) ?? "all",
                }),
              )
            }
            data={[
              { value: "all", label: "全部状态" },
              { value: "new", label: "待分诊" },
              { value: "triage", label: "研判中" },
              { value: "linked", label: "已关联案件" },
              { value: "dismissed", label: "已排除" },
            ]}
          />
          <MultiSelect
            label="渠道"
            placeholder="全部渠道"
            data={channels}
            value={filters.channel ? [filters.channel] : []}
            onChange={(value) =>
              dispatch(setAlertFilters({ channel: value[0] ?? "" }))
            }
            clearable
          />
          <Button
            variant="default"
            leftSection={<RotateCcw size={16} />}
            onClick={() => dispatch(resetAlertFilters())}
          >
            重置筛选
          </Button>
        </Group>
      </Paper>

      <Paper withBorder>
        <Group justify="space-between" p="md">
          <Text size="sm" fw={600}>
            已选择 {selectedIds.length} 条
          </Text>
          <Group>
            <Select
              w={260}
              aria-label="目标案件"
              value={caseTargetId}
              onChange={(value) => dispatch(setCaseTargetId(value ?? ""))}
              data={cases.map((item) => ({
                value: item.id,
                label: `${item.id} ${item.title}`,
              }))}
            />
            <Button
              leftSection={<Link2 size={16} />}
              loading={isStaging}
              onClick={() => void stage("link")}
            >
              加入批次并关联
            </Button>
            <Button
              variant="light"
              color="gray"
              leftSection={<EyeOff size={16} />}
              loading={isStaging}
              disabled={selectedIds.length === 0}
              onClick={() => void stage("dismiss")}
            >
              加入批次并排除
            </Button>
          </Group>
        </Group>
        <Table.ScrollContainer minWidth={1120}>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={42}>
                  <Checkbox
                    aria-label="选择当前结果"
                    checked={allCurrentSelected}
                    indeterminate={
                      selectedIds.length > 0 && !allCurrentSelected
                    }
                    onChange={(event) =>
                      dispatch(
                        setAlertSelection(
                          event.currentTarget.checked
                            ? alerts.map((item) => item.id)
                            : [],
                        ),
                      )
                    }
                  />
                </Table.Th>
                <Table.Th>告警信息</Table.Th>
                <Table.Th>账户 / 对手方</Table.Th>
                <Table.Th>设备 / IP</Table.Th>
                <Table.Th>金额</Table.Th>
                <Table.Th>风险</Table.Th>
                <Table.Th>状态</Table.Th>
                <Table.Th>版本</Table.Th>
                <Table.Th>时间</Table.Th>
                <Table.Th>案件</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {alerts.map((alert) => {
                const inActiveBatch = activeBatch?.actions.some(
                  (action) => action.alertId === alert.id,
                );
                return (
                  <Table.Tr
                    key={alert.id}
                    className={inActiveBatch ? "table-row-focused" : undefined}
                  >
                    <Table.Td>
                      <Checkbox
                        aria-label={`选择 ${alert.id}`}
                        checked={selectedIds.includes(alert.id)}
                        onChange={() =>
                          dispatch(
                            setAlertSelection(
                              selectedIds.includes(alert.id)
                                ? selectedIds.filter((id) => id !== alert.id)
                                : [...selectedIds, alert.id],
                            ),
                          )
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {alert.title}
                      </Text>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {alert.id} · {alert.channel}
                      </Text>
                      <Text size="xs" c="dimmed" mt={4}>
                        {alert.tags.join(" / ")}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{alert.account}</Text>
                      <Text size="xs" c="dimmed">
                        对手方 {alert.counterparty}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {alert.deviceId}
                      </Text>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {alert.ip}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <NumberFormatter
                        value={alert.amount}
                        thousandSeparator
                        prefix="¥"
                      />
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={4}>
                        <RiskBadge value={alert.riskLevel} />
                        <Text size="xs" c="dimmed">
                          评分 {alert.score}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <AlertStatusBadge value={alert.status} />
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="outline" color="gray">
                        V{alert.version}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        {new Date(alert.detectedAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {alert.caseId ? (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          onClick={() => navigate(`/cases/${alert.caseId}`)}
                        >
                          打开案件
                        </Button>
                      ) : (
                        <Text size="xs" c="dimmed">
                          未关联
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      {activeBatch ? (
        <TriageBatchPanel
          batch={activeBatch}
          investigationCase={caseById.get(activeBatch.caseId)}
          active
        />
      ) : (
        <Paper withBorder p="md" bg="gray.0">
          <Group justify="space-between">
            <Group gap="sm">
              <History size={18} />
              <Text size="sm" c="dimmed">
                当前没有编辑中的分诊批次。勾选告警并加入批次后，可在此核对版本、附带证据并作为一个本地事务提交。
              </Text>
            </Group>
          </Group>
        </Paper>
      )}

      {recoverableBatches.length > 0 ? (
        <Stack gap="sm">
          <Group gap="xs">
            <History size={16} />
            <Title order={5}>恢复入口（其他窗口或上次会话保留）</Title>
            <Badge variant="light" color="orange">
              {recoverableBatches.length}
            </Badge>
          </Group>
          {recoverableBatches.map((batch) => (
            <TriageBatchPanel
              key={batch.id}
              batch={batch}
              investigationCase={caseById.get(batch.caseId)}
              active={false}
              onActivate={() => {
                setActiveBatch(batch.id);
                notifications.show({
                  color: "blue",
                  title: "已恢复批次",
                  message: `${batch.id} 已设为当前处理批次。`,
                });
              }}
            />
          ))}
        </Stack>
      ) : null}

      {committedBatches.length > 0 ? (
        <Stack gap="sm">
          <Title order={5}>本页已提交事务</Title>
          {committedBatches.map((batch) => (
            <TriageBatchPanel
              key={batch.id}
              batch={batch}
              investigationCase={caseById.get(batch.caseId)}
              active={false}
              onClearCommitted={pruneCommittedBatches}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
