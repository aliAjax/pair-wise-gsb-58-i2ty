import {
  Alert,
  Button,
  Checkbox,
  Group,
  MultiSelect,
  NumberFormatter,
  Paper,
  Select,
  Stack,
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
} from "lucide-react";
import { useMemo, useRef } from "react";
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
import { TriageBatchPanel } from "../features/alerts/TriageBatchPanel";
import type { TriageBatch, TriageOperation } from "../models/types";
import {
  useGetAlertsQuery,
  useGetCasesQuery,
  useGetTriageBatchesQuery,
  useSaveTriageDraftMutation,
} from "../services/api";
import { createId, nowIso } from "../services/mockStorage";

const CURRENT_ACTOR = "林澜";

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
  const { data: batches = [] } = useGetTriageBatchesQuery();
  const [saveDraft] = useSaveTriageDraftMutation();
  const batchPanelRef = useRef<HTMLDivElement>(null);

  const recoverableBatches = batches.filter(
    (item) =>
      item.status !== "draft" || item.operations.length > 0,
  );

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

  // 把勾选结果登记进本地草稿批次：每条操作都记录提交前看到的版本号，
  // 提交事务时逐条核对，版本不一致整批拒绝并标记冲突。
  const stageOperations = async (kind: "link_alert" | "dismiss_alert") => {
    if (selectedIds.length === 0) {
      notifications.show({
        color: "red",
        title: "无法加入批次",
        message: "请先勾选至少一条告警。",
      });
      return;
    }
    const targetCase = cases.find((item) => item.id === caseTargetId);
    if (kind === "link_alert" && !targetCase) {
      notifications.show({
        color: "red",
        title: "无法加入批次",
        message: "请选择目标案件。",
      });
      return;
    }

    const operations: TriageOperation[] = [];
    for (const alertId of selectedIds) {
      const alert = alerts.find((item) => item.id === alertId);
      if (!alert) {
        continue;
      }
      operations.push({
        id: createId("OP"),
        kind,
        alertId,
        caseId: kind === "link_alert" ? caseTargetId : undefined,
        baseAlertVersion: alert.version,
        baseCaseVersion:
          kind === "link_alert" ? targetCase?.version : undefined,
      });
    }
    if (operations.length === 0) {
      return;
    }

    const draft = batches.find((item) => item.status === "draft");
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
    // 同一告警只保留最新一次登记，避免批次内出现相互覆盖的操作。
    const stagedAlertIds = new Set(operations.map((item) => item.alertId));
    const next: TriageBatch = {
      ...base,
      operations: [
        ...base.operations.filter((item) => !stagedAlertIds.has(item.alertId)),
        ...operations,
      ],
      updatedAt: nowIso(),
    };
    try {
      await saveDraft(next).unwrap();
      dispatch(setAlertSelection([]));
      notifications.show({
        color: "blue",
        title: "已加入本地批次",
        message: `${operations.length} 条操作已记录提交前版本号，提交批次后才会入库。`,
      });
      batchPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    } catch {
      notifications.show({
        color: "red",
        title: "批次保存失败",
        message: "本地批次写入失败，请重试。",
      });
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>告警中心</Title>
          <Text c="dimmed" size="sm" mt={4}>
            对账户、设备、IP 和交易线索进行组合筛选，分诊操作先进入本地批次再统一入库。
          </Text>
        </div>
        <Text size="sm" c="dimmed">
          {isFetching ? "正在刷新本地服务..." : `共 ${alerts.length} 条结果`}
        </Text>
      </Group>

      {recoverableBatches.length > 0 ? (
        <Alert
          color="blue"
          icon={<History size={16} />}
          title={`已从本地恢复 ${recoverableBatches.length} 个未入库批次`}
        >
          <Group justify="space-between" align="center">
            <Text size="sm">
              包含草稿、待重试或冲突批次，提交或处理前不会改动告警、案件与审计。
            </Text>
            <Button
              size="compact-xs"
              variant="light"
              onClick={() =>
                batchPanelRef.current?.scrollIntoView({ behavior: "smooth" })
              }
            >
              继续处理
            </Button>
          </Group>
        </Alert>
      ) : null}

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

      <div ref={batchPanelRef}>
        <TriageBatchPanel />
      </div>

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
              onClick={() => void stageOperations("link_alert")}
            >
              加入关联批次
            </Button>
            <Button
              variant="light"
              color="gray"
              leftSection={<EyeOff size={16} />}
              disabled={selectedIds.length === 0}
              onClick={() => void stageOperations("dismiss_alert")}
            >
              排除加入批次
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
                <Table.Th>时间</Table.Th>
                <Table.Th>案件</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {alerts.map((alert) => (
                <Table.Tr key={alert.id}>
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
                    <Stack gap={4}>
                      <AlertStatusBadge value={alert.status} />
                      <Text size="xs" c="dimmed">
                        版本 v{alert.version}
                      </Text>
                    </Stack>
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
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
