import {
  TeamOutlined,
  ReadOutlined,
  AppstoreOutlined,
  SendOutlined,
  DashboardOutlined,
  GiftOutlined,
  SafetyCertificateOutlined,
  MailOutlined,
  NotificationOutlined,
  TrophyOutlined,
  AuditOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import { adminResources } from "../providers/admin-routing";

const icons = [
  <TeamOutlined />,
  <ReadOutlined />,
  <AppstoreOutlined />,
  <SendOutlined />,
  <DashboardOutlined />,
  <GiftOutlined />,
  <SafetyCertificateOutlined />,
  <MailOutlined />,
  <NotificationOutlined />,
  <TrophyOutlined />,
  <AuditOutlined />,
  <FolderOpenOutlined />,
];
export const navigationResources = adminResources.map((resource, index) => ({
  ...resource,
  meta: { ...resource.meta, icon: icons[index] },
}));
