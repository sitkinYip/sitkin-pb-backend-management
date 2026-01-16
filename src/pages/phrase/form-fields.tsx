import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, InputNumber, Tabs } from "antd";

const PhraseItemEditor = ({ name, fieldKeyPrefix }: { name: number; fieldKeyPrefix: string }) => {
  return (
    <div style={{ 
        marginBottom: 16, 
        padding: 16, 
        border: '1px solid #d9d9d9', 
        borderRadius: 6,
        position: 'relative',
        backgroundColor: '#fafafa'
    }}>
       <div style={{ marginBottom: 12, fontWeight: 'bold' }}>{fieldKeyPrefix} #{name + 1}</div>
       
       <Form.Item
           name={[name, 'text']}
           label="文本内容"
           rules={[{ required: true, message: "请输入文本内容" }]}
       >
           <Input.TextArea rows={2} placeholder="请输入文本" />
       </Form.Item>

       <Form.Item
           name={[name, 'audio']}
           label="音频地址"
       >
           <Input placeholder="音频 URL" prefix={<span style={{color: '#999'}}>♫</span>} />
       </Form.Item>

       <Form.Item
           name={[name, 'duration']}
           label="时长 (秒)"
       >
           <InputNumber min={0} step={0.1} style={{ width: 150 }} placeholder="0.0" />
       </Form.Item>
    </div>
  );
};

export const PhraseFormFields = () => {
  return (
    <Tabs defaultActiveKey="basic">
      <Tabs.TabPane tab="基础信息" key="basic">
        <Form.Item
          name="title"
          label="标题"
        >
          <Input placeholder="请输入标题" />
        </Form.Item>
        <Form.Item
          name="from"
          label="来源"
          rules={[{ required: true }]}
        >
          <Input placeholder="请输入来源" />
        </Form.Item>
      </Tabs.TabPane>

      <Tabs.TabPane tab="短语列表 (Phrase)" key="phraseList">
          <Form.List name="phraseList">
            {(fields, { add, remove }) => (
                <>
                {fields.map(({ key, name, ...restField }) => (
                    <div key={key} style={{ position: 'relative' }}>
                        <PhraseItemEditor name={name} fieldKeyPrefix="Phrase" />
                        <Button 
                            type="text" 
                            danger 
                            icon={<MinusCircleOutlined />} 
                            onClick={() => remove(name)}
                            style={{ position: 'absolute', top: 12, right: 12, zIndex: 1 }}
                        >
                            删除
                        </Button>
                    </div>
                ))}
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                    添加短语
                </Button>
                </>
            )}
          </Form.List>
      </Tabs.TabPane>

      <Tabs.TabPane tab="谢幕列表 (Take A Bow)" key="takeABowList">
          <Form.List name="takeABowList">
            {(fields, { add, remove }) => (
                <>
                {fields.map(({ key, name, ...restField }) => (
                    <div key={key} style={{ position: 'relative' }}>
                        <PhraseItemEditor name={name} fieldKeyPrefix="Item" />
                        <Button 
                            type="text" 
                            danger 
                            icon={<MinusCircleOutlined />} 
                            onClick={() => remove(name)}
                            style={{ position: 'absolute', top: 12, right: 12, zIndex: 1 }}
                        >
                            删除
                        </Button>
                    </div>
                ))}
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                    添加谢幕项
                </Button>
                </>
            )}
          </Form.List>
      </Tabs.TabPane>
    </Tabs>
  );
};
