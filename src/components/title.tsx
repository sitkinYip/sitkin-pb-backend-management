import { Link } from "react-router";
import { Typography, Space, theme } from "antd";

const { Title: AntdTitle } = Typography;

export const Title = ({ collapsed }: { collapsed: boolean }) => {
  const { token } = theme.useToken();

  return (
    <Link to="/">
      <Space style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 24px" }}>
        {/* Placeholder Logo or Icon could go here */}
        {!collapsed && (
          <AntdTitle
             style={{
                fontSize: "18px",
                marginBottom: 0,
                color: token.colorTextHeading,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
             }}
          >
            sitkin-pb后台
          </AntdTitle>
        )}
      </Space>
    </Link>
  );
};
