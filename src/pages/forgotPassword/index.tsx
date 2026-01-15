import { AuthPage } from "@refinedev/antd";
import { Title } from "../../components/title";

export const ForgotPassword = () => {
  return <AuthPage type="forgotPassword" title={<Title collapsed={false} />} />;
};
