import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input } from "antd";

export const OptionEditor = () => {
  return (
    <Form.List name="options">
      {(fields, { add, remove }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {fields.map(({ key, name, ...restField }, index) => (
            <Card
              key={key}
              size="small"
              title={`Option ${index + 1}`}
              extra={
                <MinusCircleOutlined
                  onClick={() => remove(name)}
                  style={{ color: "red" }}
                />
              }
            >
              <Form.Item
                {...restField}
                name={[name, "key"]}
                label="Key"
                rules={[{ required: true }]}
              >
                <Input placeholder="A, B, 1, 2..." />
              </Form.Item>
              <Form.Item
                {...restField}
                name={[name, "text"]}
                label="Text"
              >
                <Input.TextArea rows={1} />
              </Form.Item>
              <Form.Item
                {...restField}
                name={[name, "img"]}
                label="Image URL"
              >
                <Input />
              </Form.Item>
               <Form.Item
                {...restField}
                name={[name, "video"]}
                label="Video URL"
              >
                <Input />
              </Form.Item>
            </Card>
          ))}
          <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
            Add Option
          </Button>
        </div>
      )}
    </Form.List>
  );
};
