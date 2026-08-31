import { Select, Switch } from "antd";
import { AlistMediaInput } from "../../components/Alist/AlistMediaInput";
import { Field } from "../ui";

export type FormPath = (string | number)[];

/**
 * Shared player-facing presentation fields.
 *
 * Completion flow intentionally stays outside this component: published
 * sessions may update music/background/title visibility without changing the
 * completion target or finale behavior.
 */
export function PresentationFields({ prefix }: { prefix: FormPath }) {
  return (
    <>
      <Field name={[...prefix, "bgmMode"]} label="背景音乐模式">
        <Select
          options={[
            { value: "inherit", label: "继承场次 / 不指定" },
            { value: "custom", label: "指定音乐" },
            { value: "silent", label: "静音" },
          ]}
        />
      </Field>
      <Field name={[...prefix, "bgmUrl"]} label="背景音乐">
        <AlistMediaInput type="audio" />
      </Field>
      <Field name={[...prefix, "backgroundMode"]} label="背景图片模式">
        <Select
          options={[
            { value: "inherit", label: "继承场次 / 不指定" },
            { value: "custom", label: "指定背景" },
            { value: "none", label: "不显示背景图" },
          ]}
        />
      </Field>
      <Field
        name={[...prefix, "hideTitle"]}
        label="不显示题目标题"
        valuePropName="checked"
      >
        <Switch />
      </Field>
      <Field name={[...prefix, "backgroundUrl"]} label="背景图片">
        <AlistMediaInput type="img" />
      </Field>
    </>
  );
}
