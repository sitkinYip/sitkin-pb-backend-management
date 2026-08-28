import React, { useState, useEffect } from "react";
import { Button, Space, Typography, Popconfirm, Tooltip } from "antd";
import { CloudOutlined } from "@ant-design/icons";
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
            <Text
              type="secondary"
              className="admin-resource-account"
              title={username}
            >
              资源库 · {username}
            </Text>
            <Popconfirm
              title="断开资源库连接？不会退出管理后台。"
              onConfirm={handleLogout}
            >
              <Button type="link" size="small" danger>
                断开资源库
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Tooltip title="上传图片、视频或音频时需要单独登录 Alist；已有链接可直接使用。">
            <Button
              icon={<CloudOutlined />}
              onClick={() => setLoginModalOpen(true)}
            >
              连接资源库
            </Button>
          </Tooltip>
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
