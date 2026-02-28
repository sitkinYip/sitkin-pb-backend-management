import { Show, TextField } from "@refinedev/antd";
import { useShow } from "@refinedev/core";
import { Typography } from "antd";
import { MultiQuestClueRecord } from "../../interfaces";

const { Title } = Typography;

export const MultiQuestClueShow = () => {
  const { query } = useShow<MultiQuestClueRecord>();
  const { data, isLoading } = query;

  const record = data?.data;

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>ID</Title>
      <TextField value={record?.id} />
      <Title level={5}>匹配关卡</Title>
      <TextField value={record?.qas} />
      <Title level={5}>富文本内容</Title>
      <TextField value={record?.content} />
      <Title level={5}>创建时间</Title>
      <TextField value={record?.created} />
    </Show>
  );
};
