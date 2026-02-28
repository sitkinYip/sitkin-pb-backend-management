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

export const MultiQuestClueList = () => {
  const { tableProps } = useTable<MultiQuestClueRecord>({
    syncWithLocation: true,
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
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
