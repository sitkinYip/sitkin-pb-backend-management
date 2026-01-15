import {
  DeleteButton,
  EditButton,
  List,
  ShowButton,
  useTable,
} from "@refinedev/antd";
import { BaseRecord } from "@refinedev/core";
import { Space, Table } from "antd";
import { LevelRecord } from "../../interfaces";

export const LevelList = () => {
  const { tableProps } = useTable<LevelRecord>({
    syncWithLocation: true,
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
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
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
