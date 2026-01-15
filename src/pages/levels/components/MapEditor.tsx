import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Input, Space } from "antd";
import React, { useEffect } from "react";

/**
 * Since standard Form.List works on arrays, not objects,
 * we need to transform the object { key: value } into an array [{ key, value }]
 * for editing, and transforms it back on submit...
 *
 * Actually, for simplicity in Refine/Antd Forms, it's often easier if the backend accepts
 * the array format or if we use a custom component that acts as a controlled input.
 *
 * However, the user's types say `query?: Record<string, string>`.
 * So this component needs to accept `value` (object) and call `onChange` (object).
 */

interface MapEditorProps {
  value?: Record<string, string>;
  onChange?: (value: Record<string, string>) => void;
}

export const MapEditor = ({ value = {}, onChange }: MapEditorProps) => {
  // Convert object to array for rendering
  const [items, setItems] = React.useState<{ k: string; v: string }[]>([]);

  useEffect(() => {
    // Current valid object derived from items
    const currentValidObj: Record<string, string> = {};
    items.forEach(({ k, v }) => {
      if (k) currentValidObj[k] = v;
    });

    // Check if incoming value matches our current valid state
    // If they match, it means the update is likely a robust echo of our own change (excluding empty keys),
    // so we should NOT reset items, preserving our draft (empty) rows.
    if (JSON.stringify(value) === JSON.stringify(currentValidObj)) {
      return;
    }

    if (value) {
      const newItems = Object.entries(value).map(([k, v]) => ({ k, v }));
      setItems(newItems);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const triggerChange = (newItems: { k: string; v: string }[]) => {
    setItems(newItems);
    if (onChange) {
      const newObj: Record<string, string> = {};
      newItems.forEach(({ k, v }) => {
        if (k) newObj[k] = v;
      });
      onChange(newObj);
    }
  };

  const handleAdd = () => {
    triggerChange([...items, { k: "", v: "" }]);
  };

  const handleRemove = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    triggerChange(newItems);
  };

  const handleChangeKey = (index: number, newKey: string) => {
    const newItems = [...items];
    newItems[index].k = newKey;
    triggerChange(newItems);
  };

  const handleChangeValue = (index: number, newValue: string) => {
    const newItems = [...items];
    newItems[index].v = newValue;
    triggerChange(newItems);
  };

  return (
    <div>
      {items.map((item, index) => (
        <Space
          key={index}
          style={{ display: "flex", marginBottom: 8 }}
          align="baseline"
        >
          <Input
            placeholder="Key"
            value={item.k}
            onChange={(e) => handleChangeKey(index, e.target.value)}
          />
          <Input
            placeholder="Value"
            value={item.v}
            onChange={(e) => handleChangeValue(index, e.target.value)}
          />
          <MinusCircleOutlined onClick={() => handleRemove(index)} />
        </Space>
      ))}
      <Button type="dashed" onClick={handleAdd} block icon={<PlusOutlined />}>
       添加参数
      </Button>
    </div>
  );
};
