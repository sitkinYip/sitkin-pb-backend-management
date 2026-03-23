import { DateField, List, useTable, EditButton, DeleteButton } from "@refinedev/antd";
import { BaseRecord } from "@refinedev/core";
import { Space, Table, Tag } from "antd";

const STORAGE_KEY = "letter_pageSize";
const savedPageSize = Number(localStorage.getItem(STORAGE_KEY)) || 10;

export const LetterList = () => {
  const { tableProps } = useTable({
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
        <Table.Column dataIndex="from" title="来源" width={120} ellipsis />
        <Table.Column dataIndex="title" title="标题" width={160} ellipsis />
        <Table.Column dataIndex="desc" title="描述" width={200} ellipsis />
        <Table.Column
          dataIndex="bgImg"
          title="主背景图"
          width={80}
          render={(value) => (
            value ? <img src={value} alt="bg" style={{ height: 40, objectFit: "cover" }} /> : "-"
          )}
        />
        <Table.Column
          dataIndex="type"
          title="类型"
          width={100}
          render={(value) => <Tag>{value}</Tag>}
        />
        <Table.Column
          dataIndex="created"
          title="创建时间"
          width={160}
          render={(value) => <DateField value={value} format="YYYY-MM-DD HH:mm" />}
        />
        <Table.Column
          dataIndex="updated"
          title="更新时间"
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
