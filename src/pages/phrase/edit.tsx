import { Edit, useForm } from "@refinedev/antd";
import { Form } from "antd";
import { PhraseFormFields } from "./form-fields";

export const PhraseEdit = () => {
  const { formProps, saveButtonProps } = useForm();

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <PhraseFormFields />
      </Form>
    </Edit>
  );
};
