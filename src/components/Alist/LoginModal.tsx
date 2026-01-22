import React, { useState } from "react";
import { Modal, Form, Input, message } from "antd";
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
      title="登录 ALIST"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="登录"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="username"
          label="用户名"
          rules={[{ required: true, message: "请输入用户名" }]}
        >
          <Input placeholder="即使默认admin也请在此处填入" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password placeholder="ALIST 密码" />
        </Form.Item>
      </Form>
    </Modal>
  );
};
