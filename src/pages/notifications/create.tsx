import { Create, useForm } from "@refinedev/antd";
import { Form } from "antd";
import { NotificationFormFields } from "./form-fields";

export const NotificationCreate = () => {
  const { formProps, saveButtonProps } = useForm();

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <NotificationFormFields />
      </Form>
    </Create>
  );
};
