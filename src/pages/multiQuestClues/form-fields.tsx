import { Form, Input } from "antd";
import { TextSyntaxHelp } from "../levels/components/ThreadEditor";

export const MultiQuestClueFormFields = () => {
  return (
    <>
      <Form.Item
        name="qas"
        label="关卡序列 (如: 1,2,3)"
        rules={[
          {
            required: true,
            message: "请输入题目的 qas",
          },
        ]}
      >
        <Input placeholder="输入 qas 参数匹配标识" />
      </Form.Item>
      <Form.Item
        name="title"
        label="标题"
        rules={[
          {
            message: "请输入标题",
          },
        ]}
      >
        <Input placeholder="输入弹窗标题" />
      </Form.Item>
      <Form.Item
        name="content"
        label="线索内容 (支持项目富文本配置)"
        rules={[
          {
            required: true,
            message: "请输入线索内容",
          },
        ]}
      >
        <Input.TextArea rows={8} placeholder="支持 \n 或者 {{imgUrl}} 语法" />
      </Form.Item>
      <Form.Item style={{ marginTop: "-16px" }}>
        <TextSyntaxHelp />
      </Form.Item>
    </>
  );
};
