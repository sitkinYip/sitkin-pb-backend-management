import { Edit, useForm } from "@refinedev/antd";
import { Form } from "antd";
import { MultiQuestClueRecord } from "../../interfaces";
import { MultiQuestClueFormFields } from "./form-fields";

export const MultiQuestClueEdit = () => {
  const { formProps, saveButtonProps } = useForm<MultiQuestClueRecord>({});

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <MultiQuestClueFormFields />
      </Form>
    </Edit>
  );
};
