import { DatePicker, Form, Input, InputNumber, Select, Tabs } from "antd";
import dayjs from "dayjs";
import { MapEditor } from "./components/MapEditor";
import { OptionEditor } from "./components/OptionEditor";
import { PenaltyEditor } from "./components/PenaltyEditor";
import { QuestionEditor } from "./components/QuestionEditor";
import { ThreadEditor } from "./components/ThreadEditor";

export const LevelFormFields = () => {
    const typeValue = Form.useWatch("type");
    
  return (
    <Tabs defaultActiveKey="basic">
      <Tabs.TabPane tab="基础信息" key="basic">
        <Form.Item
          name="step"
          label="Step"
          rules={[{ required: true }]}
        >
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="type"
          label="题目类型"
          initialValue="FillInTheBlank"
        >
          <Select
            options={[
              { label: "填空题", value: "FillInTheBlank" },
              { label: "选择题", value: "MultipleChoice" },
            ]}
          />
        </Form.Item>
        <Form.Item name="title" label="问题标题">
          <Input />
        </Form.Item>
        <Form.Item name="placeholder" label="填空题时input框上的描述">
          <Input />
        </Form.Item>
        <Form.Item
          name="answer"
          label="答案"
          rules={[{ required: true }]}
        >
          <Input />
        </Form.Item>
          <Form.Item
            name="isFinalLevel"
            label="是否为最终关卡"
            valuePropName="checked"
        >
            <Input type="checkbox" />
        </Form.Item>
        <Form.Item name="rankName" label="当前关卡等级昵称">
            <Input />
        </Form.Item>
        <Form.Item name="userName" label="当前用户昵称">
            <Input />
        </Form.Item>
        <Form.Item name="avatar" label="当前用户头像">
            <Input />
        </Form.Item>
        <Form.Item
            name="startTime"
            label="当前关卡开始时间"
            getValueProps={(value) => ({
                value: value ? dayjs(value) : "",
            })}
            normalize={(value) => {
                return value ? value.toISOString() : "";
            }}
        >
            <DatePicker showTime />
        </Form.Item>
        <Form.Item
            name="endTime"
            label="当前关卡结束时间"
            getValueProps={(value) => ({
                value: value ? dayjs(value) : "",
            })}
            normalize={(value) => {
                return value ? value.toISOString() : "";
            }}
        >
            <DatePicker showTime />
        </Form.Item>
      </Tabs.TabPane>

      <Tabs.TabPane tab="题目配置" key="question">
        <QuestionEditor />
      </Tabs.TabPane>

      <Tabs.TabPane tab="线索配置" key="thread">
        <ThreadEditor />
      </Tabs.TabPane>
        
    {typeValue === "MultipleChoice" && (
         <Tabs.TabPane tab="选择题选项" key="options">
            <OptionEditor />
        </Tabs.TabPane>
    )}

      <Tabs.TabPane tab="增强配置" key="configs">
        <Form.Item label="选择题答错的冻结时间配置">
           <PenaltyEditor />
        </Form.Item>

        <Form.Item label="通关后的跳转配置">
             <div style={{ padding: 16, border: '1px solid #d9d9d9', borderRadius: 6 }}>
                <Form.Item name={["FinalLevelConfig", "link"]} label="跳转链接">
                    <Input />
                </Form.Item>
                <Form.Item name={["FinalLevelConfig", "path"]} label="跳转路由地址">
                    <Input />
                </Form.Item>
                 <Form.Item name={["FinalLevelConfig", "query"]} label="路由参数">
                    <MapEditor />
                </Form.Item>
             </div>
        </Form.Item>
      </Tabs.TabPane>
    </Tabs>
  );
};
