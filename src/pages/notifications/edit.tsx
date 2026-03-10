import { Edit, useForm } from "@refinedev/antd";
import { Form } from "antd";
import { NotificationFormFields } from "./form-fields";

export const NotificationEdit = () => {
  const { formProps, saveButtonProps } = useForm();

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <NotificationFormFields />
      </Form>
    </Edit>
  );
};
