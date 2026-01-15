import { Edit, useForm } from "@refinedev/antd";
import { Form } from "antd";
import { LevelFormFields } from "./form-fields";

export const LevelEdit = () => {
  const { formProps, saveButtonProps } = useForm();

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <LevelFormFields />
      </Form>
    </Edit>
  );
};
