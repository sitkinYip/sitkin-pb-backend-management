import {
  DeleteButton,
  EditButton,
  List,
  ShowButton,
  useTable,
} from "@refinedev/antd";
import { BaseRecord, useCreate } from "@refinedev/core";
import { Button, Space, Table } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { LevelRecord } from "../../interfaces";

const STORAGE_KEY = "levels_pageSize";
const savedPageSize = Number(localStorage.getItem(STORAGE_KEY)) || 10;

export const LevelList = () => {
  const { tableProps } = useTable<LevelRecord>({
    syncWithLocation: true,
    pagination: {
      pageSize: savedPageSize,
    },
  });

  const { mutate: createLevel } = useCreate();

  const handleCopyRecord = (record: BaseRecord) => {
    const excludeKeys = new Set(["id", "created", "updated", "collectionId", "collectionName"]);
    const values = Object.fromEntries(
      Object.entries(record).filter(([key]) => !excludeKeys.has(key))
    );
    createLevel({
      resource: "levels",
      values,
    });
  };

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
        <Table.Column dataIndex="step" title="Step" sorter />
        <Table.Column
          dataIndex="question"
          title="Question"
          render={(value) => {
             if (Array.isArray(value)) {
                 return JSON.stringify(value).slice(0, 50) + "...";
             }
             return value;
          }}
        />
        <Table.Column dataIndex="placeholder" title="Placeholder" />
        <Table.Column
          dataIndex="thread"
          title="Thread"
           render={(value) => {
             if (Array.isArray(value)) {
                 return JSON.stringify(value).slice(0, 50) + "...";
             }
             return value;
          }}
        />
        <Table.Column dataIndex="answer" title="Answer" />
        <Table.Column
          title="Actions"
          dataIndex="actions"
          render={(_, record: BaseRecord) => (
            <Space>
              <EditButton hideText size="small" recordItemId={record.id} />
              <ShowButton hideText size="small" recordItemId={record.id} />
              <DeleteButton hideText size="small" recordItemId={record.id} />
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => handleCopyRecord(record)}
              />
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
