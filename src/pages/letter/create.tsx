import { Create, useForm } from "@refinedev/antd";
import { Form } from "antd";
import { LetterFormFields } from "./form-fields";

export const LetterCreate = () => {
  const { formProps, saveButtonProps } = useForm();

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <LetterFormFields />
      </Form>
    </Create>
  );
};
