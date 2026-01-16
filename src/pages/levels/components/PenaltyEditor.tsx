import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, InputNumber, Space } from "antd";

export const PenaltyEditor = () => {
  return (
    <Form.List name="penaltyConfig">
      {(fields, { add, remove }) => (
        <>
          {fields.map((field) => (
             <Space key={field.key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
              <Form.Item
                {...field}
                noStyle
                rules={[{ required: true }]}
              >
                 <InputNumber placeholder="单位毫秒 -1为永远冻结" style={{width: 200}} />
              </Form.Item>
              <MinusCircleOutlined onClick={() => remove(field.name)} />
            </Space>
          ))}
          <Form.Item>
            <Button
                type="dashed"
                onClick={() => add()}
                style={{ width: "100%" }}
                icon={<PlusOutlined />}
                >
                添加一条选择题惩戒时长
            </Button>
          </Form.Item>
        </>
      )}
    </Form.List>
  );
};
