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
        pagination={{
          ...tableProps.pagination,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          locale: { items_per_page: " 条/页" },
          onShowSizeChange: (_, size) => localStorage.setItem(STORAGE_KEY, String(size)),
        }}
      >
        <Table.Column dataIndex="id" title="Id" />
        <Table.Column dataIndex="from" title="From" />
        <Table.Column dataIndex="title" title="Title" />
        <Table.Column 
            title="Phrase Count" 
            render={(_, record: PhraseListRecord) => record.phraseList?.length || 0}
        />
        <Table.Column 
            title="Take A Bow Count" 
            render={(_, record: PhraseListRecord) => record.takeABowList?.length || 0}
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
