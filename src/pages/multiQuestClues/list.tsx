import {
  DeleteButton,
  EditButton,
  List,
  ShowButton,
  useTable,
} from "@refinedev/antd";
import { BaseRecord } from "@refinedev/core";
import { Space, Table } from "antd";
import { MultiQuestClueRecord } from "../../interfaces";

const STORAGE_KEY = "multi_quest_clues_pageSize";
const savedPageSize = Number(localStorage.getItem(STORAGE_KEY)) || 10;

export const MultiQuestClueList = () => {
  const { tableProps } = useTable<MultiQuestClueRecord>({
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
        <Table.Column dataIndex="id" title="ID" />
        <Table.Column dataIndex="qas" title="匹配的关卡(qas)" />
        <Table.Column 
          dataIndex="content" 
          title="富文本内容"
          render={(val) => val && val.length > 50 ? val.substring(0, 50) + "..." : val}
        />
        <Table.Column
          title="Actions"
          dataIndex="actions"
          render={(_, record: BaseRecord) => (
            <Space>
              <EditButton hideText size="small" recordItemId={record.id} />
              <ShowButton hideText size="small" recordItemId={record.id} />
              <DeleteButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
