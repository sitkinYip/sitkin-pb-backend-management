import { Create, useForm } from "@refinedev/antd";
import { Form } from "antd";
import { LevelFormFields } from "./form-fields";

export const LevelCreate = () => {
  const { formProps, saveButtonProps } = useForm();

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <LevelFormFields />
      </Form>
    </Create>
  );
};
