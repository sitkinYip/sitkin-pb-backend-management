import React, { useState, useEffect } from "react";
import { Button, Space, Typography, Popconfirm } from "antd";
import { alistService } from "@/services/alist";
import { LoginModal } from "./LoginModal";

const { Text } = Typography;

export const AlistStatus: React.FC = () => {
  const [username, setUsername] = useState<string | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  const checkLoginStatus = () => {
    if (alistService.checkToken()) {
      setUsername(alistService.getUsername());
    } else {
      setUsername(null);
    }
  };

  useEffect(() => {
    checkLoginStatus();

    const handleLogin = () => checkLoginStatus();
    const handleLogout = () => checkLoginStatus();

    window.addEventListener("alist-login", handleLogin);
    window.addEventListener("alist-logout", handleLogout);

    return () => {
      window.removeEventListener("alist-login", handleLogin);
      window.removeEventListener("alist-logout", handleLogout);
    };
  }, []);

  const handleLogout = () => {
    alistService.logout();
  };

  return (
    <>
      <Space>
        {username ? (
          <Space>
            <Text type="secondary">alist: {username}</Text>
            <Popconfirm title="确认退出 ALIST 登录?" onConfirm={handleLogout}>
              <Button type="link" size="small" danger>
                退出
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Button size="small" onClick={() => setLoginModalOpen(true)}>
            登录 ALIST
          </Button>
        )}
      </Space>

      <LoginModal
        open={loginModalOpen}
        onSuccess={() => setLoginModalOpen(false)}
        onCancel={() => setLoginModalOpen(false)}
      />
    </>
  );
};
