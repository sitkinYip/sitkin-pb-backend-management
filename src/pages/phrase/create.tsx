import { Create, useForm } from "@refinedev/antd";
import { Form } from "antd";
import { PhraseFormFields } from "./form-fields";

export const PhraseCreate = () => {
  const { formProps, saveButtonProps } = useForm();

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <PhraseFormFields />
      </Form>
    </Create>
  );
};
