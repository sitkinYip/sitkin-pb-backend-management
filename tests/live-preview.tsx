// Local-only Vite fixture: no auth provider, API client or production data.
import React from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, Form, Input, Select, theme } from "antd";
import { LivePreview } from "../src/game/preview/LivePreview";
import "../src/styles/admin.css";
function Fixture() {
  const [form] = Form.useForm();
  const notification =
    new URLSearchParams(location.search).get("kind") === "notification";
  return (
    <ConfigProvider
      theme={{
        algorithm: location.search.includes("dark")
          ? theme.darkAlgorithm
          : theme.defaultAlgorithm,
      }}
    >
      <App>
        <div style={{ padding: 16 }}>
          <LivePreview
            form={form}
            kind={notification ? "notification" : "question"}
          >
            <Form
              form={form}
              layout="vertical"
              initialValues={
                notification
                  ? {
                      title: "测试通知",
                      content: "通知正文",
                      popupTitle: "弹窗标题",
                      buttonText: "我知道了",
                    }
                  : {
                      title: "测试题目",
                      kind: "text",
                      placeholder: "请输入答案",
                      content: [{ text: "第一段正文", hint: "提示内容" }],
                      options: [
                        { key: "A", text: "甲" },
                        { key: "B", text: "乙" },
                      ],
                    }
              }
            >
              <Form.Item name="title" label="标题">
                <Input />
              </Form.Item>
              {notification ? (
                <>
                  <Form.Item name="content" label="正文">
                    <Input.TextArea />
                  </Form.Item>
                  <Form.Item name="popupTitle" label="弹窗标题">
                    <Input />
                  </Form.Item>
                  <Form.Item name="buttonText" label="按钮文字">
                    <Input />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Form.Item name="kind" label="题型">
                    <Select
                      options={[
                        { value: "text", label: "填空" },
                        { value: "choice", label: "单选" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name={["content", 0, "text"]} label="正文">
                    <Input.TextArea />
                  </Form.Item>
                  <Form.Item name={["content", 0, "hint"]} label="提示">
                    <Input />
                  </Form.Item>
                  <Form.Item name={["content", 0, "imageUrl"]} label="图片">
                    <Input />
                  </Form.Item>
                </>
              )}
            </Form>
          </LivePreview>
        </div>
      </App>
    </ConfigProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
