import { DateField, List, useTable, EditButton, DeleteButton } from "@refinedev/antd";
import { BaseRecord } from "@refinedev/core";
import { Space, Table, Tag } from "antd";

export const LetterList = () => {
  const { tableProps } = useTable({
    syncWithLocation: true,
  });

  return (
    <List>
      <Table
        {...tableProps}
        rowKey="id"
        pagination={{
          ...tableProps.pagination,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          locale: { items_per_page: " 条/页" },
        }}
      >
        <Table.Column dataIndex="id" title="Id" />
        <Table.Column dataIndex="from" title="From" />
        <Table.Column dataIndex="title" title="Title" />
        <Table.Column dataIndex="desc" title="Description" />
        <Table.Column
          dataIndex="bgImg"
          title="Main Bg"
          render={(value) => (
             value ? <img src={value} alt="bg" style={{ height: 40, objectFit: 'cover' }} /> : '-'
          )}
        />
        <Table.Column
          dataIndex="type"
          title="Type"
          render={(value) => <Tag>{value}</Tag>}
        />
        <Table.Column
          dataIndex="created"
          title="Created"
          render={(value) => <DateField value={value} />}
        />
        <Table.Column
          dataIndex="updated"
          title="Updated"
          render={(value) => <DateField value={value} />}
        />
        <Table.Column
          title="Actions"
          dataIndex="actions"
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
