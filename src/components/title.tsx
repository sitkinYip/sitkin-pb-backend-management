import { Link } from "react-router";
import { CompassOutlined } from "@ant-design/icons";

export const Title = ({ collapsed }: { collapsed: boolean }) => {
  return (
    <Link to="/" className="admin-brand" aria-label="答题运营台首页">
      <span className="admin-brand-mark">
        <CompassOutlined />
      </span>
      {!collapsed && <span className="admin-brand-name">答题运营台</span>}
    </Link>
  );
};
