import {
  Show,
  TextField,
  NumberField,
  DateField,
} from "@refinedev/antd";
import { useShow } from "@refinedev/core";
import { Typography } from "antd";
import { LevelRecord } from "../../interfaces";

const { Title } = Typography;

export const LevelShow = () => {
  const { query } = useShow<LevelRecord>();
  const { data, isLoading } = query;

  const record = data?.data;

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>ID</Title>
      <TextField value={record?.id} />

      <Title level={5}>Title</Title>
      <TextField value={record?.title} />

      <Title level={5}>Step</Title>
      <NumberField value={record?.step ?? ""} />

      <Title level={5}>Type</Title>
      <TextField value={record?.type} />

      <Title level={5}>Question</Title>
      <pre>{JSON.stringify(record?.question, null, 2)}</pre>

      <Title level={5}>Answer</Title>
      <TextField value={record?.answer} />

      <Title level={5}>Placeholder</Title>
      <TextField value={record?.placeholder} />

      <Title level={5}>Thread</Title>
      <pre>{JSON.stringify(record?.thread, null, 2)}</pre>

      <Title level={5}>Options</Title>
      <pre>{JSON.stringify(record?.options, null, 2)}</pre>

      <Title level={5}>Penalty Config</Title>
      <pre>{JSON.stringify(record?.penaltyConfig, null, 2)}</pre>

      <Title level={5}>Final Level Config</Title>
      <pre>{JSON.stringify(record?.FinalLevelConfig, null, 2)}</pre>

      <Title level={5}>Created At</Title>
      <DateField value={record?.created} />

      <Title level={5}>Updated At</Title>
      <DateField value={record?.updated} />
    </Show>
  );
};
