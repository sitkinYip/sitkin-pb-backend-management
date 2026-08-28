import React, { useState } from "react";
import { Modal, Form, Input, message, Typography } from "antd";
import { alistService } from "@/services/alist";

interface LoginModalProps {
  open: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  open,
  onSuccess,
  onCancel,
}) => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await alistService.login(values.username, values.password);
      message.success("登录成功");
      onSuccess();
    } catch (error: unknown) {
      // Form validation error will be caught here too, but we only want to show message for api error
      const err = error as {
        errorFields?: { name: (string | number)[]; errors: string[] }[];
        message?: string;
      };
      if (err.errorFields) {
        return;
      }
      message.error(err.message || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="连接资源库（Alist）"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="连接"
      cancelText="取消"
    >
      <Typography.Paragraph type="secondary">
        用于上传和管理图片、视频、音频。这里使用 Alist
        账号，与答题后台管理员账号相互独立；仅粘贴已有链接不需要连接。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={handleOk}>
        <Form.Item
          name="username"
          label="用户名"
          rules={[{ required: true, message: "请输入用户名" }]}
        >
          <Input placeholder="输入 Alist 用户名" autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password
            placeholder="输入 Alist 密码"
            autoComplete="current-password"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};
