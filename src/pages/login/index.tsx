import { useLogin } from "@refinedev/core";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { Navigate, useLocation } from "react-router";
import {
  ADMIN_LOGIN,
  normalizeAdminLoginSearch,
} from "../../providers/admin-routing";

export function LoginRoute() {
  const location = useLocation();
  const search = normalizeAdminLoginSearch(location.search);
  if (search !== location.search)
    return <Navigate to={{ pathname: ADMIN_LOGIN, search }} replace />;
  return <Login />;
}

export function Login() {
  const { mutate: login, isPending } = useLogin();
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <Card style={{ width: 420, maxWidth: "100%" }}>
        <Typography.Title level={2}>Questions 管理后台</Typography.Title>
        <Typography.Paragraph type="secondary">
          使用独立的业务管理员账号登录。
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={(values) => login(values)}>
          <Form.Item
            name="account"
            label="管理员账号"
            rules={[{ required: true }]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button block type="primary" htmlType="submit" loading={isPending}>
            登录
          </Button>
        </Form>
        <Alert
          style={{ marginTop: 24 }}
          message="不开放注册。首次部署需初始化业务管理员；PocketBase 超级管理员账号不能在这里使用。"
          type="info"
        />
      </Card>
    </main>
  );
}
