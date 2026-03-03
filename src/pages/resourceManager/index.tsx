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
  Modal,
  theme,
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
  PlayCircleOutlined,
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

// 分页每页可选条数
const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50", "100"];

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

// 媒体预览弹窗状态
interface PreviewState {
  open: boolean;
  type: "video" | "audio";
  url: string;
  name: string;
}

export const ResourceManager: React.FC = () => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { token } = theme.useToken();

  const [activeType, setActiveType] = useState<MediaType>("img");
  const [fileList, setFileList] = useState<AlistFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [preview, setPreview] = useState<PreviewState>({
    open: false,
    type: "video",
    url: "",
    name: "",
  });

  const pendingUploadFileRef = useRef<File | null>(null);
  // 用于关闭预览时停止媒体播放
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  // refresh=true 时强制 Alist 重新索引目录，用于上传后刷新
  const fetchFileList = useCallback(async (type: MediaType, refresh = false) => {
    if (!alistService.checkToken()) {
      setFileList([]);
      return;
    }

    setLoading(true);
    try {
      const files = await alistService.listFiles(type, refresh);
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
      // 仅匹配 Alist 明确的登录失效消息，避免把 JSON 解析错误等误判为登录失效
      const AUTH_PATTERNS = ["请先登录", "token is expired", "token is invalid", "invalid or expired", "unauthorized"];
      const isAuth = AUTH_PATTERNS.some((p) => errorMessage?.toLowerCase().includes(p.toLowerCase()));
      if (isAuth) {
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
      const { url, taskId } = await alistService.uploadFile(file, activeType);

      if (taskId) {
        // 大文件：任务已提交，立即停止 loading 并通知用户
        message.info("大文件上传任务已提交，正在后台上传中…完成后列表将自动刷新", 5);
        // 后台非阻塞轮询，完成后自动刷新列表
        alistService.pollUploadTask(
          taskId,
          file.name,
          activeType,
          () => {
            message.success(
              <span>
                {file.name} 上传完成！
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
            fetchFileList(activeType, true);
          },
          (errMsg) => message.error(`${file.name} 上传失败：${errMsg}`)
        );
      } else {
        // 小文件：同步完成，直接刷新
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
        fetchFileList(activeType, true);
      }
    } catch (error: unknown) {
      const errorMessage = (error as { message?: string })?.message;
      const AUTH_PATTERNS = ["请先登录", "token is expired", "token is invalid", "invalid or expired", "unauthorized"];
      const isAuth = AUTH_PATTERNS.some((p) => errorMessage?.toLowerCase().includes(p.toLowerCase()));
      if (isAuth) {
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
      // 登录后刷新，同样强制重新索引
      fetchFileList(activeType, true);
    }
  };

  // 关闭预览时停止播放
  const handleClosePreview = () => {
    if (mediaRef.current) {
      mediaRef.current.pause();
      mediaRef.current.src = "";
    }
    setPreview((prev) => ({ ...prev, open: false }));
  };

  // 打开视频/音频预览
  const openPreview = (type: "video" | "audio", url: string, name: string) => {
    setPreview({ open: true, type, url, name });
  };

  const filteredFiles = searchKeyword
    ? fileList.filter((file) =>
        file.name.toLowerCase().includes(searchKeyword.toLowerCase())
      )
    : fileList;

  const getFileUrl = (fileName: string) =>
    alistService.getPublicUrl(fileName, activeType);

  // 缩略图尺寸
  const thumbSize = isMobile ? 60 : 80;

  const renderFilePreview = (file: AlistFileItem) => {
    const url = getFileUrl(file.name);

    if (activeType === "img") {
      return (
        <Image
          src={url}
          alt={file.name}
          width={thumbSize}
          height={thumbSize}
          style={{ objectFit: "cover", borderRadius: 6 }}
          fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjZjVmNWY1Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNjY2MiIGZvbnQtc2l6ZT0iMTIiPuWbvueJhzwvdGV4dD48L3N2Zz4="
        />
      );
    }

    // 视频/音频：可点击的预览块，点击弹出播放器
    const isVideo = activeType === "video";
    const iconColor = isVideo ? "#722ed1" : "#52c41a";
    const IconCmp = isVideo ? VideoCameraOutlined : AudioOutlined;

    return (
      <Tooltip title={`点击预览${MEDIA_TYPE_CONFIG[activeType].label}`}>
        <div
          onClick={() => openPreview(activeType as "video" | "audio", url, file.name)}
          style={{
            width: thumbSize,
            height: thumbSize,
            background: token.colorFillQuaternary,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            position: "relative",
            overflow: "hidden",
            transition: "opacity 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          <IconCmp style={{ fontSize: 28, color: iconColor }} />
          {/* 悬浮播放标志 */}
          <PlayCircleOutlined
            style={{
              position: "absolute",
              fontSize: 20,
              color: "rgba(255,255,255,0.85)",
              bottom: 4,
              right: 4,
            }}
          />
        </div>
      </Tooltip>
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
          {/* 上传中用 div 包裹 Spin（避免 div 嵌套在 p 内的 HTML 非法问题） */}
          {/* 空闲时保留 p.ant-upload-drag-icon，让 antd CSS 的图标大小规则生效 */}
          {uploading ? (
            <div style={{ fontSize: 48, marginBottom: 20, textAlign: "center" }}>
              <Spin size="large" />
            </div>
          ) : (
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: "#1890ff" }} />
            </p>
          )}
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

        {/* 文件列表（含分页） */}
        <List
          loading={loading}
          dataSource={filteredFiles}
          pagination={{
            defaultPageSize: 30,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个文件`,
            size: isMobile ? "small" : "default",
            // 移动端隐藏 "共X条" 文字以节省空间
            ...(isMobile ? { simple: false } : {}),
          }}
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
                        background: token.colorFillQuaternary,
                        borderRadius: 4,
                        wordBreak: "break-all",
                      }}
                    >
                      {publicUrl}
                    </Paragraph>
                    <Space>
                      <CopyButton text={publicUrl} isMobile={isMobile} />
                      {activeType !== "img" && (
                        <Button
                          icon={<PlayCircleOutlined />}
                          size="middle"
                          onClick={() =>
                            openPreview(
                              activeType as "video" | "audio",
                              publicUrl,
                              file.name
                            )
                          }
                        >
                          预览
                        </Button>
                      )}
                    </Space>
                  </div>
                </List.Item>
              );
            }

            return (
              <List.Item
                actions={[
                  activeType !== "img" && (
                    <Button
                      key="preview"
                      icon={<PlayCircleOutlined />}
                      size="small"
                      onClick={() =>
                        openPreview(
                          activeType as "video" | "audio",
                          publicUrl,
                          file.name
                        )
                      }
                    >
                      预览
                    </Button>
                  ),
                  <CopyButton key="copy" text={publicUrl} isMobile={isMobile} />,
                ].filter(Boolean)}
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
                          background: token.colorFillQuaternary,
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

      {/* 视频 / 音频预览弹窗 */}
      <Modal
        open={preview.open}
        title={preview.name}
        onCancel={handleClosePreview}
        footer={null}
        // 移动端全屏展示
        width={isMobile ? "100vw" : preview.type === "video" ? 800 : 480}
        style={isMobile ? { top: 0, margin: 0, padding: 0, maxWidth: "100vw" } : {}}
        styles={
          isMobile
            ? { body: { padding: "12px 8px" } }
            : { body: { padding: "16px 24px" } }
        }
        destroyOnHidden
      >
        {preview.type === "video" ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={preview.url}
            controls
            autoPlay
            style={{ width: "100%", borderRadius: 6, display: "block" }}
          />
        ) : (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <AudioOutlined
              style={{ fontSize: 48, color: "#52c41a", marginBottom: 16, display: "block" }}
            />
            <audio
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
              src={preview.url}
              controls
              autoPlay
              style={{ width: "100%" }}
            />
          </div>
        )}
      </Modal>

      <LoginModal
        open={loginModalOpen}
        onSuccess={handleLoginSuccess}
        onCancel={() => setLoginModalOpen(false)}
      />
    </div>
  );
};
