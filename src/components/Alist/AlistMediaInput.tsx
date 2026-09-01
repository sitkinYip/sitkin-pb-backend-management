import React, { useEffect, useId, useRef, useState } from "react";
import { Input, Button, message, ConfigProvider } from "antd";
import {
  EyeOutlined,
  LoadingOutlined,
  UpOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { alistService } from "@/services/alist";
import { LoginModal } from "./LoginModal";
import { CSSProperties } from "react";

interface AlistMediaInputProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  type?: "img" | "video" | "audio";
  placeholder?: string;
  disabled?: boolean;
  style?: CSSProperties;
  className?: string; // Add className
}

export const AlistMediaInput: React.FC<AlistMediaInputProps> = ({
  id,
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewId = useId();
  const { componentDisabled } = ConfigProvider.useConfig();
  const isDisabled = disabled ?? componentDisabled;
  const previewUrl = value?.trim() || "";

  useEffect(() => {
    setPreviewOpen(false);
    setPreviewError(false);
  }, [previewUrl, type]);

  const handleUploadClick = () => {
    if (isDisabled) return;
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
    if (!file || isDisabled) return;

    // 清空 input value，防止选择相同文件不触发 onChange
    e.target.value = "";

    try {
      setUploading(true);
      const { url } = await alistService.uploadFile(file, type);
      message.success("上传成功");
      onChange?.(url);
    } catch (error: unknown) {
      const err = error as { message?: string };
      const AUTH_PATTERNS = [
        "请先登录",
        "token is expired",
        "token is invalid",
        "invalid or expired",
        "unauthorized",
      ];
      const isAuth = AUTH_PATTERNS.some((p) =>
        err.message?.toLowerCase().includes(p.toLowerCase()),
      );
      if (isAuth) {
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

  const getAcceptType = () => {
    switch (type) {
      case "img":
        return "image/*";
      case "video":
        return "video/*";
      case "audio":
        return "audio/*";
      default:
        return "*/*";
    }
  };

  const getPlaceholder = () => {
    if (placeholder) return placeholder;
    switch (type) {
      case "img":
        return "输入图片链接或上传";
      case "video":
        return "输入视频链接或上传";
      case "audio":
        return "输入音频链接或上传";
      default:
        return "输入链接或上传";
    }
  };

  const previewLabel =
    type === "video" ? "视频" : type === "audio" ? "音频" : "图片";

  const mediaPreview = () => {
    if (previewError)
      return (
        <div className="admin-media-preview-error" role="alert">
          {previewLabel}加载失败，请确认链接可访问且 CDN 允许当前后台域名引用。
        </div>
      );
    if (type === "video")
      return (
        <video
          key={previewUrl}
          controls
          preload="metadata"
          src={previewUrl}
          onError={() => setPreviewError(true)}
        >
          当前浏览器不支持视频预览。
        </video>
      );
    if (type === "audio")
      return (
        <audio
          key={previewUrl}
          controls
          preload="metadata"
          src={previewUrl}
          onError={() => setPreviewError(true)}
        >
          当前浏览器不支持音频预览。
        </audio>
      );
    return (
      <img
        key={previewUrl}
        src={previewUrl}
        alt="当前媒体配置预览"
        onError={() => setPreviewError(true)}
      />
    );
  };

  return (
    <div style={style} className={`admin-media-input ${className ?? ""}`}>
      <div className="admin-media-input-row">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={getPlaceholder()}
          disabled={isDisabled}
          allowClear
        />
        {previewUrl && (
          <Button
            icon={previewOpen ? <UpOutlined /> : <EyeOutlined />}
            htmlType="button"
            disabled={false}
            aria-expanded={previewOpen}
            aria-controls={previewId}
            onClick={() => {
              setPreviewError(false);
              setPreviewOpen((open) => !open);
            }}
          >
            {previewOpen ? "收起预览" : "展开预览"}
          </Button>
        )}
        <Button
          icon={uploading ? <LoadingOutlined /> : <UploadOutlined />}
          htmlType="button"
          onClick={handleUploadClick}
          disabled={isDisabled || uploading}
        >
          {uploading ? "上传中" : "上传"}
        </Button>
      </div>

      {previewOpen && previewUrl && (
        <div
          id={previewId}
          className={`admin-media-preview admin-media-preview-${type}`}
          aria-label={`${previewLabel}预览`}
        >
          {mediaPreview()}
        </div>
      )}

      {/* 隐藏的文件输入框 */}
      <input
        type="file"
        disabled={isDisabled}
        ref={fileInputRef}
        style={{ display: "none" }}
        accept={getAcceptType()}
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
