import { useLogin } from "@refinedev/core";
import { Button, Card, Form, Input, Typography } from "antd";
import { CompassOutlined } from "@ant-design/icons";
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
    <main className="admin-login">
      <div className="admin-login-panel">
        <div className="admin-login-brand">
          <span className="admin-brand-mark">
            <CompassOutlined />
          </span>
          答题运营台
        </div>
        <Card className="admin-login-card">
          <Typography.Title level={1}>登录工作台</Typography.Title>
          <Typography.Paragraph type="secondary">
            管理活动内容，照顾每一次答题体验。
          </Typography.Paragraph>
          <Form layout="vertical" onFinish={(values) => login(values)}>
            <Form.Item
              name="account"
              label="管理员账号"
              rules={[{ required: true, message: "请输入管理员账号" }]}
            >
              <Input
                autoComplete="username"
                placeholder="输入业务管理员账号"
                size="large"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <Input.Password
                autoComplete="current-password"
                placeholder="输入登录密码"
                size="large"
              />
            </Form.Item>
            <Button
              block
              size="large"
              type="primary"
              htmlType="submit"
              loading={isPending}
            >
              登录
            </Button>
          </Form>
          <Typography.Paragraph type="secondary" className="admin-login-note">
            仅限业务管理员。没有账号或忘记密码，请联系负责人；PocketBase
            超级管理员账号不用于此处。
          </Typography.Paragraph>
        </Card>
      </div>
    </main>
  );
}
