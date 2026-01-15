import { AuthPage } from "@refinedev/antd";
import { Title } from "../../components/title";

export const Register = () => {
  return <AuthPage type="register" title={<Title collapsed={false} />} />;
};
