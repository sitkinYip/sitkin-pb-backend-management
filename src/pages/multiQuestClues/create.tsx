import { Create, useForm } from "@refinedev/antd";
import { Form } from "antd";
import { MultiQuestClueRecord } from "../../interfaces";
import { MultiQuestClueFormFields } from "./form-fields";

export const MultiQuestClueCreate = () => {
  const { formProps, saveButtonProps } = useForm<MultiQuestClueRecord>({});

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <MultiQuestClueFormFields />
      </Form>
    </Create>
  );
};
