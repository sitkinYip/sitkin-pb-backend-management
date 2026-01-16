import { Edit, useForm } from "@refinedev/antd";
import { Form } from "antd";
import { LetterFormFields } from "./form-fields";

export const LetterEdit = () => {
  const { formProps, saveButtonProps } = useForm();

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <LetterFormFields />
      </Form>
    </Edit>
  );
};
