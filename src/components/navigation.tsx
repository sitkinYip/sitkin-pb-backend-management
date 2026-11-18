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
  BellOutlined,
  SettingOutlined,
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
  <BellOutlined />,
  <TrophyOutlined />,
  <SettingOutlined />,
  <AuditOutlined />,
  <FolderOpenOutlined />,
];
export const navigationResources = adminResources.map((resource, index) => ({
  ...resource,
  meta: { ...resource.meta, icon: icons[index] },
}));
