import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input } from "antd";
import { AlistMediaInput } from "@/components/Alist/AlistMediaInput";

export const OptionEditor = () => {
  return (
    <Form.List name="options">
      {(fields, { add, remove }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {fields.map(({ key, name, ...restField }, index) => (
            <Card
              key={key}
              size="small"
              title={`选项 ${index + 1}`}
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
                label="Key(选项)"
                rules={[{ required: true }]}
              >
                <Input placeholder="A, B, 1, 2..." />
              </Form.Item>
              <Form.Item
                {...restField}
                name={[name, "text"]}
                label="文案"
              >
                <Input.TextArea rows={1} />
              </Form.Item>
              <Form.Item
                {...restField}
                name={[name, "img"]}
                label="图片链接"
              >
                <AlistMediaInput type="img" />
              </Form.Item>
               <Form.Item
                {...restField}
                name={[name, "video"]}
                label="视频链接"
              >
                <AlistMediaInput type="video" />
              </Form.Item>
            </Card>
          ))}
          <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
            添加选项
          </Button>
        </div>
      )}
    </Form.List>
  );
};
