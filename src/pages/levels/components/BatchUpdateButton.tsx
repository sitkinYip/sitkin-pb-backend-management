import { Modal, Form, Input, DatePicker, Switch, Button, message, Alert, Select } from 'antd';
import { useUpdateMany } from '@refinedev/core';
import dayjs, { Dayjs } from 'dayjs';
import { useState } from 'react';

interface BatchUpdateProps {
  selectedRowKeys: string[];
  onSuccess?: () => void;
}

export const BatchUpdateButton = ({ selectedRowKeys, onSuccess }: BatchUpdateProps) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();
  const { mutate: updateMany } = useUpdateMany();

  const handleBatchUpdate = async (values: any) => {
    // 构建更新数据，只包含有值的字段
    const updateData: Record<string, any> = {};
    
    if (values.userName !== undefined && values.userName !== null && values.userName !== '') {
      updateData.userName = values.userName;
    }
    if (values.avatar !== undefined && values.avatar !== null && values.avatar !== '') {
      updateData.avatar = values.avatar;
    }
    if (values.startTime !== undefined && values.startTime !== null) {
      updateData.startTime = (values.startTime as Dayjs).toISOString();
    }
    if (values.endTime !== undefined && values.endTime !== null) {
      updateData.endTime = (values.endTime as Dayjs).toISOString();
    }
    if (values.rank !== undefined && values.rank !== null && values.rank !== '') {
      updateData.rank = values.rank;
    }
    if (values.rankName !== undefined && values.rankName !== null && values.rankName !== '') {
      updateData.rankName = values.rankName;
    }
    if (values.autoNext !== undefined && values.autoNext !== null && values.autoNext !== 'no_change') {
      // value 是数字类型：1 = true, 0 = false
      updateData.autoNext = values.autoNext === 1;
    }

    // 如果没有要更新的字段，直接返回
    if (Object.keys(updateData).length === 0) {
      message.warning('请至少填写一个要修改的字段');
      return;
    }

    try {
      await updateMany({
        resource: 'levels',
        ids: selectedRowKeys as string[],
        values: updateData,
      });

      message.success(`成功更新 ${selectedRowKeys.length} 条记录`);
      setModalVisible(false);
      form.resetFields();
      onSuccess?.();
    } catch (error) {
      message.error('批量更新失败');
      console.error(error);
    }
  };

  return (
    <>
      <Button 
        type="primary" 
        disabled={selectedRowKeys.length === 0}
        onClick={() => setModalVisible(true)}
        style={{ marginBottom: 16 }}
      >
        批量修改选中项 ({selectedRowKeys.length})
      </Button>

      <Modal
        title="批量修改"
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        onOk={() => {
          form.submit();
        }}
        destroyOnClose={true}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleBatchUpdate}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="userName"
            label="用户名"
            tooltip="不修改请留空"
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            name="rankName"
            label="当前关卡等级昵称"
            tooltip="不修改请留空"
          >
            <Input placeholder="请输入当前关卡等级昵称" />
          </Form.Item>

          <Form.Item
            name="rank"
            label="当前关卡等级"
            tooltip="不修改请留空"
          >
            <Input placeholder="请输入当前关卡等级" />
          </Form.Item>

          <Form.Item
            name="avatar"
            label="当前用户头像 URL"
            tooltip="不修改请留空"
          >
            <Input.TextArea placeholder="请输入头像 URL" rows={2} />
          </Form.Item>

          <Form.Item
            name="startTime"
            label="开始时间"
            tooltip="不修改请留空"
          >
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="endTime"
            label="结束时间"
            tooltip="不修改请留空"
          >
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="autoNext"
            label="是否自动跳转下一题 (多题型有效)"
            tooltip="选择'是'或'否'来修改，选择'不修改'则保持不变"
            initialValue="no_change"
          >
            <Select
              options={[
                { label: '不修改（保持原样）', value: 'no_change' },
                { label: '是', value: 1 },
                { label: '否', value: 0 },
              ]}
            />
          </Form.Item>
        </Form>

        <Alert
          message="注意：仅会更新上面填写的字段，未填写的字段不会影响原有数据"
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
        />
      </Modal>
    </>
  );
};
