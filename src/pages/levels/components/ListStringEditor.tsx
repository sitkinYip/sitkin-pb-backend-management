import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Space } from "antd";

interface ListStringEditorProps {
  name: string | number | (string | number)[];
  label?: string;
  className?: string;
}

export const ListStringEditor = ({ name, label }: ListStringEditorProps) => {
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <>
          {label && <div style={{ marginBottom: 8 }}>{label}</div>}
          {fields.map((field) => (
            <Form.Item key={field.key} style={{ marginBottom: 8 }}>
              <Space style={{ display: "flex" }} align="baseline">
                <Form.Item
                  {...field}
                  noStyle
                  rules={[{ required: true, message: "Required" }]}
                >
                  <Input placeholder="Item URL or text" style={{ minWidth: "300px" }} />
                </Form.Item>
                <MinusCircleOutlined
                  className="dynamic-delete-button"
                  onClick={() => remove(field.name)}
                />
              </Space>
            </Form.Item>
          ))}
          <Form.Item>
            <Button
              type="dashed"
              onClick={() => add()}
              style={{ width: "100%" }}
              icon={<PlusOutlined />}
            >
              新增一条
            </Button>
          </Form.Item>
        </>
      )}
    </Form.List>
  );
};
