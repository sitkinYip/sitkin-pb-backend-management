import {
  useThemedLayoutContext,
  type RefineThemedLayoutHeaderProps,
} from "@refinedev/antd";
import { useGetIdentity } from "@refinedev/core";
import { Button, Layout, Switch, Tooltip } from "antd";
import { MenuOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { useContext } from "react";
import { useLocation } from "react-router";
import { ColorModeContext } from "../../contexts/color-mode";
import { adminResources } from "../../providers/admin-routing";
import { AlistStatus } from "../Alist/AlistStatus";

export const Header: React.FC<RefineThemedLayoutHeaderProps> = ({
  sticky = true,
}) => {
  const { data: user } = useGetIdentity<{ name: string }>();
  const { mode, setMode } = useContext(ColorModeContext);
  const { mobileSiderOpen, setMobileSiderOpen } = useThemedLayoutContext();
  const { pathname } = useLocation();
  const current =
    adminResources.find((resource) => resource.list === pathname)?.meta.label ??
    "运营工作台";
  return (
    <Layout.Header
      className="admin-header"
      style={sticky ? { position: "sticky", top: 0, zIndex: 20 } : undefined}
    >
      <div className="admin-header-context">
        <Button
          className="admin-mobile-menu"
          type="text"
          icon={<MenuOutlined />}
          aria-label="打开导航菜单"
          aria-expanded={mobileSiderOpen}
          onClick={() => setMobileSiderOpen(true)}
        />
        <span>{current}</span>
      </div>
      <div className="admin-header-tools">
        <AlistStatus />
        <Tooltip title={mode === "light" ? "切换为深色外观" : "切换为浅色外观"}>
          <Switch
            checkedChildren={<MoonOutlined />}
            unCheckedChildren={<SunOutlined />}
            aria-label="深色外观"
            checked={mode === "dark"}
            onChange={(checked) => setMode(checked ? "dark" : "light")}
          />
        </Tooltip>
        {user?.name && (
          <span className="admin-header-user" title={user.name}>
            {user.name}
          </span>
        )}
      </div>
    </Layout.Header>
  );
};
