import React, { useState, useRef } from "react";
import { Input, Button, message } from "antd";
import { UploadOutlined, LoadingOutlined } from "@ant-design/icons";
import { alistService } from "@/services/alist";
import { LoginModal } from "./LoginModal";
import { CSSProperties } from "react";

interface AlistMediaInputProps {
  value?: string;
  onChange?: (value: string) => void;
  type?: "img" | "video";
  placeholder?: string;
  disabled?: boolean;
  style?: CSSProperties;
  className?: string;
}

export const AlistMediaInput: React.FC<AlistMediaInputProps> = ({
  value,
  onChange,
  type = "img",
  placeholder,
  disabled,
  style,
  className,
}) => {
  const [uploading, setUploading] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    // 检查 Token
    if (!alistService.checkToken()) {
      setLoginModalOpen(true);
      return;
    }
    // 触发文件选择
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 清空 input value，防止选择相同文件不触发 onChange
    e.target.value = "";

    try {
      setUploading(true);
      const url = await alistService.uploadFile(file, type);
      message.success("上传成功");
      onChange?.(url);
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message === "请先登录" || err.message?.includes("token")) {
        // 如果 token 失效，弹出登录框
        setLoginModalOpen(true);
      } else {
        message.error(err.message || "上传失败");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleLoginSuccess = () => {
    setLoginModalOpen(false);
    // 登录成功后，自动触发文件选择
    fileInputRef.current?.click();
  };

  return (
    <div style={{ display: "flex", gap: 8, ...style }} className={className}>
      <Input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder || (type === "img" ? "输入图片链接或上传" : "输入视频链接或上传")}
        disabled={disabled}
        allowClear
      />
      <Button
        icon={uploading ? <LoadingOutlined /> : <UploadOutlined />}
        onClick={handleUploadClick}
        disabled={disabled || uploading}
      >
        {uploading ? "上传中" : "上传"}
      </Button>
      
      {/* 隐藏的文件输入框 */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        accept={type === "img" ? "image/*" : "video/*"}
        onChange={handleFileChange}
      />

      <LoginModal
        open={loginModalOpen}
        onSuccess={handleLoginSuccess}
        onCancel={() => setLoginModalOpen(false)}
      />
    </div>
  );
};
