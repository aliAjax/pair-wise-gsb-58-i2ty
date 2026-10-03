import {
  Button,
  Checkbox,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { FilePlus2 } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  EvidenceStrength,
  TriageBatch,
  TriageEvidenceDraft,
} from "../../models/types";
import { useUpdateTriageEvidenceMutation } from "../../services/api";

const defaultOccurredAt = (): string => {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

interface Props {
  batch: TriageBatch;
}

/**
 * 证据草稿仅存在批次中，提交事务时才随告警/案件一起落库；
 * 批次未提交前关闭页面也不会丢失。
 */
export function EvidenceDraftForm({ batch }: Props) {
  const [updateEvidence] = useUpdateTriageEvidenceMutation();
  const [enabled, setEnabled] = useState(Boolean(batch.evidenceDraft));
  const [form, setForm] = useState<TriageEvidenceDraft>(
    batch.evidenceDraft ?? {
      title: "批量分诊关联证据",
      source: "告警中心批量分诊",
      strength: "medium",
      occurredAt: defaultOccurredAt(),
      attachment: "triage-batch-export",
      note: "随批量关联一并登记，关联依据需结合原始告警复核。",
    },
  );

  useEffect(() => {
    setEnabled(Boolean(batch.evidenceDraft));
    if (batch.evidenceDraft) {
      setForm(batch.evidenceDraft);
    }
  }, [batch.id, batch.evidenceDraft]);

  const save = (next: Partial<TriageEvidenceDraft>, nextEnabled = enabled) => {
    const draft: TriageEvidenceDraft = { ...form, ...next };
    setForm(draft);
    void updateEvidence({
      batchId: batch.id,
      draft: nextEnabled ? draft : undefined,
    });
  };

  return (
    <Stack gap="sm" mt="sm">
      <Checkbox
        checked={enabled}
        onChange={(event) => {
          const checked = event.currentTarget.checked;
          setEnabled(checked);
          void updateEvidence({
            batchId: batch.id,
            draft: checked ? form : undefined,
          });
        }}
        label="提交本批时一并登记一条证据"
        description="证据与告警、案件、审计在同一事务中入库；批次未成功提交前不会写入证据台账。"
      />
      {enabled ? (
        <>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <TextInput
              label="证据名称"
              value={form.title}
              onChange={(event) => save({ title: event.currentTarget.value })}
            />
            <TextInput
              label="证据来源"
              value={form.source}
              onChange={(event) => save({ source: event.currentTarget.value })}
            />
            <Select
              label="证据强度"
              value={form.strength}
              onChange={(value) =>
                save({ strength: (value as EvidenceStrength) ?? "medium" })
              }
              data={[
                { value: "strong", label: "强证据" },
                { value: "medium", label: "中等证据" },
                { value: "weak", label: "弱证据" },
              ]}
            />
            <TextInput
              type="datetime-local"
              label="发生时间"
              value={form.occurredAt.slice(0, 16)}
              onChange={(event) =>
                save({
                  occurredAt: new Date(
                    event.currentTarget.value,
                  ).toISOString(),
                })
              }
            />
            <TextInput
              label="附件标识"
              value={form.attachment}
              onChange={(event) =>
                save({ attachment: event.currentTarget.value })
              }
            />
          </SimpleGrid>
          <Textarea
            label="证据说明"
            minRows={2}
            value={form.note}
            onChange={(event) => save({ note: event.currentTarget.value })}
          />
          <Group gap="xs">
            <FilePlus2 size={15} />
            <Text size="xs" c="dimmed">
              证据只会在包含实际入库的关联动作时写入；全部动作因冲突跳过时不落证据。
            </Text>
          </Group>
        </>
      ) : null}
    </Stack>
  );
}
