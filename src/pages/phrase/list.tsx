import { DateField, List, useTable, EditButton, DeleteButton } from "@refinedev/antd";
import { BaseRecord } from "@refinedev/core";
import { Space, Table } from "antd";

import { PhraseListRecord } from "../../interfaces";

const STORAGE_KEY = "phrase_pageSize";
const savedPageSize = Number(localStorage.getItem(STORAGE_KEY)) || 10;

export const PhraseList = () => {
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
        <Table.Column
          title="短语数量"
          width={100}
          render={(_, record: PhraseListRecord) => record.phraseList?.length || 0}
        />
        <Table.Column
          title="Take A Bow 数量"
          width={140}
          render={(_, record: PhraseListRecord) => record.takeABowList?.length || 0}
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
