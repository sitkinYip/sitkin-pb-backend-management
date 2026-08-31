import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
} from "react";
import {
  Card,
  Collapse,
  Drawer,
  Empty,
  Form,
  Select,
  Table,
  Typography,
} from "antd";
import type { CardProps, DrawerProps, FormItemProps, TableProps } from "antd";
import { BookOutlined, SwapOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { fieldGuides, pageGuides } from "./guidance";

export function PageCard({
  title,
  extra,
  children,
  className = "",
  ...props
}: CardProps) {
  const guide = typeof title === "string" ? pageGuides[title] : undefined;
  return (
    <section className={`admin-page ${className}`}>
      <header className="admin-page-heading">
        <div>
          <Typography.Title level={1}>{title}</Typography.Title>
          {guide && (
            <Typography.Paragraph type="secondary">
              {guide.description}
            </Typography.Paragraph>
          )}
        </div>
        {extra && <div className="admin-page-actions">{extra}</div>}
      </header>
      <Card {...props} className="admin-page-body">
        {guide && (
          <Collapse
            className="admin-guide"
            ghost
            items={[
              {
                key: "guide",
                label: (
                  <span>
                    <BookOutlined /> 配置指引与注意事项
                  </span>
                ),
                children: (
                  <ol>
                    {guide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ),
              },
            ]}
          />
        )}
        {children}
      </Card>
    </section>
  );
}

/** Keep the actual input as Form.Item's only child: AntD owns value/onChange. */
export function Field({
  label,
  children,
  extra,
  tooltip,
  ...props
}: FormItemProps) {
  const guide =
    !props.hidden && typeof label === "string" ? fieldGuides[label] : undefined;
  let control = children;
  if (
    guide?.placeholder &&
    Children.count(children) === 1 &&
    isValidElement(children)
  ) {
    const input = children as ReactElement<{ placeholder?: string }>;
    if (!input.props.placeholder)
      control = cloneElement(input, { placeholder: guide.placeholder });
  }
  if (isValidElement(control) && control.type === Select) {
    const select = control as ReactElement<{
      placeholder?: string;
      options?: unknown[];
      showSearch?: boolean;
      optionFilterProp?: string;
      maxTagCount?: "responsive";
    }>;
    control = cloneElement(select, {
      placeholder:
        select.props.placeholder ??
        `请选择${typeof label === "string" ? label : "内容"}`,
      showSearch:
        select.props.showSearch ??
        ((select.props.options?.length ?? 0) > 6 ||
          Boolean(guide?.placeholder?.includes("搜索"))),
      optionFilterProp: select.props.optionFilterProp ?? "label",
      maxTagCount: select.props.maxTagCount ?? "responsive",
    });
  }
  return (
    <Form.Item
      {...props}
      label={label}
      tooltip={tooltip ?? guide?.detail}
      extra={
        guide ? (
          <div className="admin-field-help">
            <div>{guide.hint}</div>
            {extra}
          </div>
        ) : (
          extra
        )
      }
    >
      {control}
    </Form.Item>
  );
}

export function EditorDrawer({
  extra,
  footer,
  className = "",
  classNames,
  styles,
  ...props
}: DrawerProps) {
  return (
    <Drawer
      {...props}
      className={`admin-editor ${className}`}
      classNames={{
        ...classNames,
        wrapper: ["admin-editor-wrapper", classNames?.wrapper]
          .filter(Boolean)
          .join(" "),
      }}
      styles={{
        ...styles,
        wrapper: { ...styles?.wrapper, maxWidth: "100vw" },
      }}
      footer={
        footer ??
        (extra ? (
          <div className="admin-editor-actions">{extra}</div>
        ) : undefined)
      }
    />
  );
}

const widths: Record<string, number> = {
  操作: 300,
  题目: 240,
  题目标题: 240,
  标题: 240,
  场次: 230,
  名称: 220,
  奖品: 220,
  原因: 260,
  "引用 / 编辑限制": 280,
  通用线索: 120,
  状态: 140,
  结果: 190,
  时间: 180,
  发送时间: 180,
  核销时间: 180,
  类型: 100,
  版本: 80,
  关卡数: 100,
  序号: 80,
  启用: 100,
  登录账号: 170,
  昵称: 180,
  玩家: 190,
  "等级 / 经验": 170,
  "任务 ID": 190,
  "操作人 ID": 190,
  "对象 ID": 190,
  对象类型: 160,
};
export function columnWidth(title: unknown) {
  return typeof title === "string" ? (widths[title] ?? 160) : 160;
}
export function displayTime(value: unknown) {
  if (!value) return "—";
  const date = dayjs(String(value));
  return date.isValid() ? date.format("YYYY-MM-DD HH:mm") : String(value);
}

/** Narrow screens scroll inside the table; columns never compress to single characters. */
export function AdminTable<T extends object = Record<string, unknown>>({
  columns = [],
  scroll,
  pagination,
  className = "",
  locale,
  ...props
}: TableProps<T>) {
  const fitted = columns.map((column) => ({
    ...column,
    width: column.width ?? columnWidth(column.title),
    ...("dataIndex" in column &&
    ["created", "createdAt", "redeemedAt", "submittedAt", "sentAt"].includes(
      String(column.dataIndex),
    ) &&
    !column.render
      ? { render: displayTime }
      : {}),
  }));
  const minWidth = fitted.reduce(
    (total, column) =>
      total + (typeof column.width === "number" ? column.width : 180),
    props.expandable ? 56 : 0,
  );
  return (
    <div className="admin-table-region">
      <div className="admin-table-hint">
        <SwapOutlined /> 表格可左右滑动，查看完整信息与操作
      </div>
      <Table<T>
        {...props}
        className={`admin-table ${className}`}
        columns={fitted}
        tableLayout="fixed"
        scroll={{
          ...scroll,
          x: Math.max(minWidth, typeof scroll?.x === "number" ? scroll.x : 0),
        }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无记录，可调整筛选或使用页面上方操作"
            />
          ),
          ...locale,
        }}
        pagination={
          pagination === false
            ? false
            : {
                defaultPageSize: 10,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50],
                showTotal: (total) => `共 ${total} 条`,
                ...pagination,
              }
        }
      />
    </div>
  );
}
