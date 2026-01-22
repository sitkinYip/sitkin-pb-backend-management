import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, InputNumber, Select, Space, Tabs } from "antd";
import { AlistMediaInput } from "@/components/Alist/AlistMediaInput";

export const LetterFormFields = () => {
  return (
    <Tabs defaultActiveKey="basic">
      <Tabs.TabPane tab="基础信息" key="basic">
        <Form.Item
          name="from"
          label="来源"
          rules={[{ required: true }]}
        >
          <Input placeholder="请输入来源" />
        </Form.Item>
        <Form.Item
          name="title"
          label="标题"
        >
          <Input placeholder="请输入标题" />
        </Form.Item>
        <Form.Item
          name="desc"
          label="描述"
        >
          <Input.TextArea placeholder="请输入描述" />
        </Form.Item>
        <Form.Item
          name="type"
          label="类型"
          initialValue="modern"
          rules={[{ required: true }]}
        >
          <Select
            options={[
              { label: "现代 (Modern)", value: "modern" },
              { label: "古典 (Classical)", value: "classical" },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="bgImg"
          label="主背景图片" // Main Background Image
        >
          <AlistMediaInput type="img" placeholder="主背景图片 URL" />
        </Form.Item>

        <Form.Item
          name="mainAudio"
          label="主音频"
        >
          <AlistMediaInput type="audio" placeholder="主音频" />
        </Form.Item>


        <Form.Item label="背景图片列表">
          <Form.List name="bgImages">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: "flex", marginBottom: 8 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={[name]}
                      rules={[{ required: true, message: "请输入图片URL" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <AlistMediaInput type="img" placeholder="图片 URL" style={{ width: '400px' }} />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} />
                  </Space>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                    添加背景图片
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
        </Form.Item>
      </Tabs.TabPane>

      <Tabs.TabPane tab="段落配置" key="paragraph">
         <Form.List name="paragraphConfigList">
             {(fields, { add, remove }) => (
                 <>
                    {fields.map(({ key, name, ...restField }) => (
                         <div key={key} style={{ 
                             marginBottom: 16, 
                             padding: 16, 
                             border: '1px solid #d9d9d9', 
                             borderRadius: 6,
                             position: 'relative',
                             backgroundColor: '#fafafa'
                         }}>
                            <div style={{ marginBottom: 12, fontWeight: 'bold' }}>配置项 #{name + 1}</div>
                            
                            <Form.Item
                                {...restField}
                                name={[name, 'content']}
                                label="文本内容"
                                rules={[{ required: true, message: "请输入段落内容" }]}
                            >
                                <Input.TextArea rows={3} placeholder="请输入段落文本内容" />
                            </Form.Item>

                            <Space size="large" align="baseline" wrap>
                                <Form.Item
                                    {...restField}
                                    name={[name, 'align']}
                                    label="对齐方式"
                                    initialValue="left"
                                    style={{ width: 200 }}
                                >
                                    <Select 
                                        options={[
                                            { label: "左对齐 (Left)", value: "left" },
                                            { label: "居中 (Center)", value: "center" },
                                            { label: "右对齐 (Right)", value: "right" },
                                            { label: "顶部 (Top)", value: "top" },
                                            { label: "底部 (Bottom)", value: "bottom" },
                                        ]} 
                                    />
                                </Form.Item>

                                <Form.Item
                                    {...restField}
                                    name={[name, 'delay']}
                                    label="延迟 (ms)"
                                    style={{ width: 150 }}
                                >
                                    <InputNumber placeholder="0" min={0} step={100} style={{ width: '100%' }} />
                                </Form.Item>
                            </Space>

                            <Form.Item
                                {...restField}
                                name={[name, 'audio']}
                                label="音频地址"
                            >
                                <AlistMediaInput type="audio" placeholder="请输入关联音频 URL" />
                            </Form.Item>

                            <Button 
                                type="text" 
                                danger 
                                icon={<MinusCircleOutlined />} 
                                onClick={() => remove(name)}
                                style={{ position: 'absolute', top: 12, right: 12 }}
                            >
                                删除
                            </Button>
                        </div>
                    ))}
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                        添加段落配置
                    </Button>
                 </>
             )}
         </Form.List>
      </Tabs.TabPane>
    </Tabs>
  );
};
