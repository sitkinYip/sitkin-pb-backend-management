import { MinusCircleOutlined, PlusOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Card, Collapse, Descriptions, Form, Input, InputNumber, Radio, Select, Typography } from "antd";

const { Text } = Typography;

const TextSyntaxHelp = () => (
  <Collapse
    size="small"
    ghost
    items={[
      {
        key: "help",
        label: (
          <Text type="secondary" style={{ fontSize: 12 }}>
            <QuestionCircleOutlined /> 文本语法说明
          </Text>
        ),
        children: (
          <Descriptions
            size="small"
            column={1}
            bordered
            labelStyle={{ fontSize: 12, whiteSpace: "nowrap" }}
            contentStyle={{ fontSize: 12, wordBreak: "break-all" }}
          >
            <Descriptions.Item label="高亮文字">
              <code>{"[[高亮内容]]"}</code> → 将文字渲染为高亮样式
            </Descriptions.Item>
            <Descriptions.Item label="链接/路由">
              <code>{"((显示文字||链接地址))"}</code> → 可点击的链接，http 开头会打开新窗口，否则作为路由跳转
            </Descriptions.Item>
            <Descriptions.Item label="内嵌图片">
              <code>{"\u007B\u007B图片URL\u007D\u007D"}</code> → 在文本中嵌入图片，点击可预览大图
            </Descriptions.Item>
            <Descriptions.Item label="换行">
              <code>{"\\n"}</code> → 文本换行
            </Descriptions.Item>
            <Descriptions.Item label="完整示例">
              <code>{"这是普通文字，[[高亮文字]]，((点击跳转||https://example.com))，\u007B\u007Bhttps://img.url/a.png\u007D\u007D"}</code>
            </Descriptions.Item>
          </Descriptions>
        ),
      },
    ]}
  />
);
import { ListStringEditor } from "./ListStringEditor";
import { MapEditor } from "./MapEditor";
import { AlistMediaInput } from "@/components/Alist/AlistMediaInput";

export const ThreadEditor = () => {
  return (
    <Form.List name="thread">
      {(fields, { add, remove }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {fields.map(({ key, name, ...restField }, index) => (
            <Card
              key={key}
              size="small"
              title={`Thread ${index + 1}`}
              extra={
                <MinusCircleOutlined
                  onClick={() => remove(name)}
                  style={{ color: "red" }}
                />
              }
            >
              <Form.Item
                {...restField}
                name={[name, "type"]}
                label="线索类型"
                rules={[{ required: true }]}
                initialValue="text"
              >
                <Radio.Group>
                  <Radio value="text">文本</Radio>
                  <Radio value="url">链接</Radio>
                  <Radio value="img">图片</Radio>
                  <Radio value="video">视频</Radio>
                  <Radio value="letter">信件</Radio>
                  <Radio value="topic">问题跳转</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item
                {...restField}
                name={[name, "title"]}
                label="标题"
              >
                <Input placeholder="请输入标题" />
              </Form.Item>
              <Form.Item
                {...restField}
                name={[name, "content"]}
                label="描述内容"
                rules={[{ required: true }]}
              >
                 <Input.TextArea placeholder="[[高亮文字可以怎么写]]" rows={2} />
              </Form.Item>
              <Form.Item
                noStyle
                shouldUpdate={(prevValues, currentValues) => prevValues.thread?.[index]?.type !== currentValues.thread?.[index]?.type}
              >
                {({ getFieldValue }) => {
                  const threadType = getFieldValue(["thread", index, "type"]);
                  return threadType === "text" ? <TextSyntaxHelp /> : null;
                }}
              </Form.Item>
              <Form.Item
                noStyle
                shouldUpdate={(prevValues, currentValues) => prevValues.thread?.[index]?.type !== currentValues.thread?.[index]?.type}
              >
                {({ getFieldValue }) => {
                  const threadType = getFieldValue(["thread", index, "type"]);
                  return (
                    <Form.Item
                      {...restField}
                      name={[name, "url"]}
                      label="URL"
                    >
                      {threadType === "img" ? (
                        <AlistMediaInput type="img" />
                      ) : threadType === "video" ? (
                        <AlistMediaInput type="video" />
                      ) : (
                        <Input />
                      )}
                    </Form.Item>
                  );
                }}
              </Form.Item>
               <Form.Item
                {...restField}
                name={[name, "path"]}
                label="路由地址"
              >
                <Input />
              </Form.Item>
               <Form.Item
                {...restField}
                name={[name, "state"]}
                label="线索状态"
              >
                <Select mode="tags" placeholder="目前只有ckickplay一个配置 当内容为video时设置这个会自动播放" />
              </Form.Item>
              <Form.Item
                {...restField}
                name={[name, "nextIndex"]}
                label="跳转到哪一题"
              >
                <InputNumber min={1} placeholder="需要选问题跳转时设置才能生效" style={{width: '100%'}} />
              </Form.Item>

              <Form.Item label="图片列表">
                 <ListStringEditor 
                    name={[name, "imgList"]} 
                    renderInput={() => <AlistMediaInput type="img" placeholder="图片 URL" style={{ minWidth: "300px" }} />}
                 />
               </Form.Item>
              
               <Form.Item
                name={[name, "query"]}
                label="路由参数"
              >
                 <MapEditor />
              </Form.Item>
            </Card>
          ))}
          <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
            添加线索
          </Button>
        </div>
      )}
    </Form.List>
  );
};
