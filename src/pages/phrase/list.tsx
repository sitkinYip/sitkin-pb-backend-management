import { DateField, List, useTable, EditButton, DeleteButton } from "@refinedev/antd";
import { BaseRecord } from "@refinedev/core";
import { Space, Table } from "antd";

import { PhraseListRecord } from "../../interfaces";

export const PhraseList = () => {
  const { tableProps } = useTable({
    syncWithLocation: true,
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
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
