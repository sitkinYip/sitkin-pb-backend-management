import { QuestionCircleOutlined } from "@ant-design/icons";
import { Collapse, Descriptions, Typography } from "antd";

/** Shared guidance for fields rendered by questions-web's RichContent. */
export const TextSyntaxHelp = () => (
  <Collapse
    size="small"
    ghost
    items={[
      {
        key: "help",
        label: (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <QuestionCircleOutlined /> 文本语法说明
          </Typography.Text>
        ),
        children: (
          <>
            <Typography.Paragraph type="secondary">
              此字段支持以下自定义标记，不是 Markdown 或 HTML 编辑器。
              将示例中的地址替换为实际可访问的链接；图片、视频可先在资源管理中上传并复制
              CDN 链接。
            </Typography.Paragraph>
            <Descriptions
              size="small"
              column={1}
              bordered
              styles={{
                label: { fontSize: 12, whiteSpace: "nowrap" },
                content: { fontSize: 12, overflowWrap: "anywhere" },
              }}
              items={[
                {
                  key: "highlight",
                  label: "高亮文字",
                  children: <code>{"[[需要强调的文字]]"}</code>,
                },
                {
                  key: "link",
                  label: "外部链接",
                  children: (
                    <>
                      <code>{"((查看详情||https://example.com))"}</code>
                      <div>
                        仅支持 http:// 或 https:// 地址，点击后在新窗口打开。
                      </div>
                    </>
                  ),
                },
                {
                  key: "route",
                  label: "站内跳转",
                  children: (
                    <>
                      <code>{"((返回首页||/))"}</code>
                      <div>
                        路径以单个 /
                        开头，必须是答题页中存在的路由，不是后台管理页面地址。
                      </div>
                    </>
                  ),
                },
                {
                  key: "image",
                  label: "内嵌图片",
                  children: (
                    <>
                      <code>{"{{https://example.com/image.png}}"}</code>
                      <div>在正文中显示图片；内嵌图片不提供点击大图预览。</div>
                    </>
                  ),
                },
                {
                  key: "video",
                  label: "内嵌视频",
                  children: (
                    <>
                      <code>{"<<https://example.com/video.mp4>>"}</code>
                      <div>显示带播放控件的视频。</div>
                    </>
                  ),
                },
                {
                  key: "poster",
                  label: "视频封面",
                  children: (
                    <code>
                      {
                        "<<https://example.com/video.mp4||https://example.com/poster.jpg>>"
                      }
                    </code>
                  ),
                },
                {
                  key: "newline",
                  label: "换行",
                  children: (
                    <>
                      在输入框中按 Enter 换行；直接输入 <code>{"\\n"}</code>{" "}
                      不会换行。
                    </>
                  ),
                },
                {
                  key: "example",
                  label: "组合示例",
                  children: (
                    <code style={{ whiteSpace: "pre-wrap" }}>
                      {
                        "请先阅读[[活动提示]]。\n((查看详情||https://example.com))\n{{https://example.com/image.png}}"
                      }
                    </code>
                  ),
                },
              ]}
            />
          </>
        ),
      },
    ]}
  />
);
