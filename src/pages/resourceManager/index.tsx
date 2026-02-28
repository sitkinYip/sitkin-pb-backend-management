import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  Tabs,
  Upload,
  Button,
  message,
  List,
  Typography,
  Space,
  Grid,
  Image,
  Tag,
  Tooltip,
  Empty,
  Spin,
  Input,
} from "antd";
import {
  UploadOutlined,
  CopyOutlined,
  ReloadOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  InboxOutlined,
  SearchOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import { alistService, AlistFileItem } from "../../services/alist";
import { LoginModal } from "../../components/Alist/LoginModal";

const { Text, Paragraph } = Typography;
const { Dragger } = Upload;
const { useBreakpoint } = Grid;

type MediaType = "img" | "video" | "audio";

const MEDIA_TYPE_CONFIG: Record<
  MediaType,
  { label: string; icon: React.ReactNode; accept: string; color: string }
> = {
  img: {
    label: "图片",
    icon: <FileImageOutlined />,
    accept: "image/*",
    color: "blue",
  },
  video: {
    label: "视频",
    icon: <VideoCameraOutlined />,
    accept: "video/*",
    color: "purple",
  },
  audio: {
    label: "音频",
    icon: <AudioOutlined />,
    accept: "audio/*",
    color: "green",
  },
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, unitIndex)).toFixed(1);
  return `${size} ${units[unitIndex]}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

interface CopyButtonProps {
  text: string;
  isMobile: boolean;
}

const CopyButton: React.FC<CopyButtonProps> = ({ text, isMobile }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      message.success("链接已复制");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      message.success("链接已复制");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Tooltip title={copied ? "已复制" : "复制链接"}>
      <Button
        type={copied ? "primary" : "default"}
        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
        onClick={handleCopy}
        size={isMobile ? "middle" : "small"}
        ghost={copied}
      >
        {isMobile ? (copied ? "已复制" : "复制") : ""}
      </Button>
    </Tooltip>
  );
};

export const ResourceManager: React.FC = () => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [activeType, setActiveType] = useState<MediaType>("img");
  const [fileList, setFileList] = useState<AlistFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");

  const pendingUploadFileRef = useRef<File | null>(null);

  const fetchFileList = useCallback(async (type: MediaType) => {
    if (!alistService.checkToken()) {
      setFileList([]);
      return;
    }

    setLoading(true);
    try {
      const files = await alistService.listFiles(type);
      const sortedFiles = files
        .filter((file) => !file.is_dir)
        .sort(
          (fileA, fileB) =>
            new Date(fileB.modified).getTime() -
            new Date(fileA.modified).getTime()
        );
      setFileList(sortedFiles);
    } catch (error: unknown) {
      const errorMessage = (error as { message?: string })?.message;
      if (
        errorMessage === "请先登录" ||
        errorMessage?.includes("token")
      ) {
        setLoginModalOpen(true);
      } else {
        message.error(errorMessage || "获取文件列表失败");
      }
      setFileList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFileList(activeType);
  }, [activeType, fetchFileList]);

  useEffect(() => {
    const handleLoginChange = () => fetchFileList(activeType);
    window.addEventListener("alist-login", handleLoginChange);
    window.addEventListener("alist-logout", handleLoginChange);
    return () => {
      window.removeEventListener("alist-login", handleLoginChange);
      window.removeEventListener("alist-logout", handleLoginChange);
    };
  }, [activeType, fetchFileList]);

  const handleUpload = async (file: File) => {
    if (!alistService.checkToken()) {
      pendingUploadFileRef.current = file;
      setLoginModalOpen(true);
      return;
    }

    setUploading(true);
    try {
      const url = await alistService.uploadFile(file, activeType);
      message.success(
        <span>
          上传成功！
          <Button
            type="link"
            size="small"
            onClick={() => {
              navigator.clipboard.writeText(url);
              message.success("链接已复制");
            }}
          >
            复制链接
          </Button>
        </span>
      );
      fetchFileList(activeType);
    } catch (error: unknown) {
      const errorMessage = (error as { message?: string })?.message;
      if (
        errorMessage === "请先登录" ||
        errorMessage?.includes("token")
      ) {
        pendingUploadFileRef.current = file;
        setLoginModalOpen(true);
      } else {
        message.error(errorMessage || "上传失败");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleLoginSuccess = () => {
    setLoginModalOpen(false);
    const pendingFile = pendingUploadFileRef.current;
    if (pendingFile) {
      pendingUploadFileRef.current = null;
      handleUpload(pendingFile);
    } else {
      fetchFileList(activeType);
    }
  };

  const filteredFiles = searchKeyword
    ? fileList.filter((file) =>
        file.name.toLowerCase().includes(searchKeyword.toLowerCase())
      )
    : fileList;

  const getFileUrl = (fileName: string) =>
    alistService.getPublicUrl(fileName, activeType);

  const renderFilePreview = (file: AlistFileItem) => {
    const url = getFileUrl(file.name);

    if (activeType === "img") {
      return (
        <Image
          src={url}
          alt={file.name}
          width={isMobile ? 60 : 80}
          height={isMobile ? 60 : 80}
          style={{ objectFit: "cover", borderRadius: 6 }}
          fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjZjVmNWY1Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNjY2MiIGZvbnQtc2l6ZT0iMTIiPuWbvueJhzwvdGV4dD48L3N2Zz4="
        />
      );
    }

    if (activeType === "video") {
      return (
        <div
          style={{
            width: isMobile ? 60 : 80,
            height: isMobile ? 60 : 80,
            background: "#f0f0f0",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <VideoCameraOutlined style={{ fontSize: 28, color: "#722ed1" }} />
        </div>
      );
    }

    return (
      <div
        style={{
          width: isMobile ? 60 : 80,
          height: isMobile ? 60 : 80,
          background: "#f0f0f0",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <AudioOutlined style={{ fontSize: 28, color: "#52c41a" }} />
      </div>
    );
  };

  const tabItems = Object.entries(MEDIA_TYPE_CONFIG).map(([key, config]) => ({
    key,
    label: (
      <span>
        {config.icon}
        <span style={{ marginLeft: 4 }}>{config.label}</span>
      </span>
    ),
  }));

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Card
        title="资源管理"
        extra={
          !isMobile && alistService.checkToken() ? (
            <Text type="secondary">
              当前账号: {alistService.getUsername()}
            </Text>
          ) : null
        }
        styles={{ body: { padding: isMobile ? 12 : 24 } }}
      >
        <Tabs
          activeKey={activeType}
          onChange={(key) => {
            setActiveType(key as MediaType);
            setSearchKeyword("");
          }}
          items={tabItems}
          size={isMobile ? "small" : "middle"}
        />

        {/* 上传区域 */}
        <Dragger
          accept={MEDIA_TYPE_CONFIG[activeType].accept}
          showUploadList={false}
          multiple={false}
          disabled={uploading}
          beforeUpload={(file) => {
            handleUpload(file);
            return false;
          }}
          style={{ marginBottom: isMobile ? 16 : 24 }}
        >
          <p className="ant-upload-drag-icon">
            {uploading ? (
              <Spin size="large" />
            ) : (
              <InboxOutlined style={{ color: "#1890ff" }} />
            )}
          </p>
          <p className="ant-upload-text">
            {uploading
              ? "上传中..."
              : isMobile
                ? `点击上传${MEDIA_TYPE_CONFIG[activeType].label}`
                : `点击或拖拽${MEDIA_TYPE_CONFIG[activeType].label}文件到此区域上传`}
          </p>
          <p className="ant-upload-hint">
            支持{MEDIA_TYPE_CONFIG[activeType].label}格式文件
          </p>
        </Dragger>

        {/* 搜索和刷新 */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 16,
            flexDirection: isMobile ? "column" : "row",
          }}
        >
          <Input
            placeholder="搜索文件名..."
            prefix={<SearchOutlined />}
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            allowClear
            style={{ flex: 1 }}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => fetchFileList(activeType)}
            loading={loading}
          >
            {isMobile ? "" : "刷新"}
          </Button>
          {!alistService.checkToken() && (
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => setLoginModalOpen(true)}
            >
              登录 Alist
            </Button>
          )}
        </div>

        {/* 文件列表 */}
        <List
          loading={loading}
          dataSource={filteredFiles}
          locale={{
            emptyText: (
              <Empty
                description={
                  alistService.checkToken()
                    ? "暂无文件"
                    : "请先登录 Alist 账号"
                }
              />
            ),
          }}
          renderItem={(file) => {
            const publicUrl = getFileUrl(file.name);

            if (isMobile) {
              return (
                <List.Item
                  style={{
                    padding: "12px 0",
                    flexDirection: "column",
                    alignItems: "stretch",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      width: "100%",
                      alignItems: "center",
                    }}
                  >
                    {renderFilePreview(file)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        strong
                        ellipsis={{ tooltip: file.name }}
                        style={{ display: "block", marginBottom: 4 }}
                      >
                        {file.name}
                      </Text>
                      <Space size={4} wrap>
                        <Tag color={MEDIA_TYPE_CONFIG[activeType].color}>
                          {MEDIA_TYPE_CONFIG[activeType].label}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatFileSize(file.size)}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatDate(file.modified)}
                        </Text>
                      </Space>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, width: "100%" }}>
                    <Paragraph
                      style={{
                        fontSize: 12,
                        margin: "0 0 8px 0",
                        padding: "6px 8px",
                        background: "#f5f5f5",
                        borderRadius: 4,
                        wordBreak: "break-all",
                      }}
                    >
                      {publicUrl}
                    </Paragraph>
                    <CopyButton text={publicUrl} isMobile={isMobile} />
                  </div>
                </List.Item>
              );
            }

            return (
              <List.Item
                actions={[
                  <CopyButton
                    key="copy"
                    text={publicUrl}
                    isMobile={isMobile}
                  />,
                ]}
              >
                <List.Item.Meta
                  avatar={renderFilePreview(file)}
                  title={
                    <Space>
                      <Text ellipsis={{ tooltip: file.name }} style={{ maxWidth: 300 }}>
                        {file.name}
                      </Text>
                      <Tag color={MEDIA_TYPE_CONFIG[activeType].color}>
                        {MEDIA_TYPE_CONFIG[activeType].label}
                      </Tag>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2} style={{ width: "100%" }}>
                      <Space split="·">
                        <Text type="secondary">{formatFileSize(file.size)}</Text>
                        <Text type="secondary">
                          {formatDate(file.modified)}
                        </Text>
                      </Space>
                      <Paragraph
                        style={{
                          fontSize: 12,
                          margin: 0,
                          padding: "4px 8px",
                          background: "#f5f5f5",
                          borderRadius: 4,
                          wordBreak: "break-all",
                        }}
                      >
                        {publicUrl}
                      </Paragraph>
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Card>

      <LoginModal
        open={loginModalOpen}
        onSuccess={handleLoginSuccess}
        onCancel={() => setLoginModalOpen(false)}
      />
    </div>
  );
};
