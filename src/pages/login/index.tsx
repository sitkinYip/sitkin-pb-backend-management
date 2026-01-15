import { AuthPage } from "@refinedev/antd";
import { Title } from "../../components/title";

export const Login = () => {
  return (
    <AuthPage
      type="login"
      title={<Title collapsed={false} />}
      formProps={{
        initialValues: { email: "", password: "" },
      }}
    />
  );
};
