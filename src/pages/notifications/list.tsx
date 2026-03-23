import { DateField, List, useTable, EditButton, DeleteButton } from "@refinedev/antd";
import { BaseRecord } from "@refinedev/core";
import { Space, Table, Tag } from "antd";
import { NotificationRecord } from "../../interfaces";

const STORAGE_KEY = "notifications_pageSize";
const savedPageSize = Number(localStorage.getItem(STORAGE_KEY)) || 10;

export const NotificationList = () => {
  const { tableProps } = useTable<NotificationRecord>({
    syncWithLocation: true,
    pagination: {
      pageSize: savedPageSize,
    },
  });

  return (
    <List>
      <Table
        {...tableProps}
        rowKey="id"
        scroll={{ x: "max-content" }}
        pagination={{
          ...tableProps.pagination,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          locale: { items_per_page: " 条/页" },
          onShowSizeChange: (_, size) => localStorage.setItem(STORAGE_KEY, String(size)),
        }}
      >
        <Table.Column dataIndex="id" title="ID" width={160} ellipsis />
        <Table.Column dataIndex="title" title="消息标题" width={140} ellipsis />
        <Table.Column
          dataIndex="popupTitle"
          title="弹窗大标题"
          width={160}
          ellipsis
          render={(value) => value || <span style={{ color: "#aaa" }}>（默认）</span>}
        />
        <Table.Column
          dataIndex="content"
          title="正文预览"
          width={220}
          ellipsis
          render={(value: string) => value?.slice(0, 40) + (value?.length > 40 ? "..." : "")}
        />
        <Table.Column
          dataIndex="enabled"
          title="状态"
          width={80}
          render={(value: boolean) =>
            value ? <Tag color="green">启用</Tag> : <Tag color="default">禁用</Tag>
          }
        />
        <Table.Column
          dataIndex="created"
          title="创建时间"
          width={160}
          render={(value) => <DateField value={value} format="YYYY-MM-DD HH:mm" />}
        />
        <Table.Column
          title="操作"
          dataIndex="actions"
          width={80}
          fixed="right"
          render={(_, record: BaseRecord) => (
            <Space>
              <EditButton hideText size="small" recordItemId={record.id} />
              <DeleteButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
