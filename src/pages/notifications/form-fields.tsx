import { Form, Input, Switch } from "antd";
import { TextSyntaxHelp } from "../levels/components/ThreadEditor";

export const NotificationFormFields = () => {
  return (
    <>
      <Form.Item
        name="title"
        label="消息标题"
        rules={[{ required: true, message: "请输入消息标题" }]}
        extra="显示在消息列表和浮标中的标题"
      >
        <Input placeholder="例：活动公告" />
      </Form.Item>

      <Form.Item
        name="popupTitle"
        label="弹窗大标题"
        extra="弹窗顶部的大标题，留空则显示默认「✨ 魔法通知 ✨」"
      >
        <Input placeholder="✨ 魔法通知 ✨" />
      </Form.Item>

      <Form.Item
        name="content"
        label="消息正文"
        rules={[{ required: true, message: "请输入消息正文" }]}
      >
        <Input.TextArea
          rows={6}
          placeholder="请输入消息正文内容..."
        />
      </Form.Item>
      <Form.Item style={{ marginTop: "-16px" }}>
        <TextSyntaxHelp />
      </Form.Item>
      <Form.Item
        name="buttonText"
        label="按钮文案"
        extra="弹窗底部关闭按钮的文案，留空则显示「✨ 知晓了」"
      >
        <Input placeholder="✨ 知晓了" />
      </Form.Item>

      <Form.Item
        name="enabled"
        label="是否启用"
        valuePropName="checked"
        initialValue={true}
        extra="启用后前端才会在轮询中拿到该消息"
      >
        <Switch />
      </Form.Item>
    </>
  );
};
