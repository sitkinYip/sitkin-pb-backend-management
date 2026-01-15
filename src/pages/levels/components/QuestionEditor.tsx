import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input } from "antd";
import { ListStringEditor } from "./ListStringEditor";

export const QuestionEditor = () => {
  return (
    <Form.List name="question">
      {(fields, { add, remove }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {fields.map(({ key, name, ...restField }, index) => (
            <Card
              key={key}
              size="small"
              title={`问题配置 ${index + 1}`}
              extra={
                <MinusCircleOutlined
                  onClick={() => remove(name)}
                  style={{ color: "red" }}
                />
              }
            >
              <Form.Item
                {...restField}
                name={[name, "text"]}
                label="问题文本"
              >
                <Input.TextArea rows={2} />
              </Form.Item>
              <Form.Item
                {...restField}
                name={[name, "tips"]}
                label="问题提示"
              >
                <Input.TextArea rows={1} />
              </Form.Item>
              <Form.Item
                {...restField}
                name={[name, "img"]}
                label="问题图片链接"
              >
                <Input />
              </Form.Item>
              <Form.Item
                {...restField}
                name={[name, "video"]}
                label="问题视频链接"
              >
                <Input />
              </Form.Item>
               <Form.Item label="问题图片列表">
                 <ListStringEditor name={[name, "imgList"]} />
               </Form.Item>
            </Card>
          ))}
          <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
            添加问题配置
          </Button>
        </div>
      )}
    </Form.List>
  );
};
