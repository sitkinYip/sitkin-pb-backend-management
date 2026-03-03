import { ALIST_CONFIG } from "../config/alist";

const TOKEN_KEY = "alist_token";

interface LoginResponse {
  code: number;
  message: string;
  data: {
    token: string;
  };
}

interface UploadResponse {
  code: number;
  message: string;
  data: {
    task?: {
      id: string;
      name: string;
      state: number;
      status: string;
      progress: number;
      error: string;
    };
  };
}

interface TaskInfoResponse {
  code: number;
  message: string;
  data: {
    id: string;
    name: string;
    // 0=等待 1=运行中 2=成功 3=取消 4=失败 5=等待重试 6=重试中
    state: number;
    status: string;
    progress: number;
    error: string;
  };
}

// 大文件阈值：超过此大小使用异步任务上传（10MB）
const ASYNC_UPLOAD_THRESHOLD = 10 * 1024 * 1024;
// 轮询间隔（ms）
const POLL_INTERVAL = 1500;
// 最大轮询次数（1.5s * 120 = 3 分钟）
const MAX_POLL_COUNT = 120;

export interface AlistFileItem {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  sign: string;
  thumb: string;
  type: number;
  hashinfo: string;
}

interface ListResponse {
  code: number;
  message: string;
  data: {
    content: AlistFileItem[] | null;
    total: number;
    readme: string;
    write: boolean;
    provider: string;
  };
}

export const alistService = {
  /**
   * 检查本地是否有 Token
   */
  checkToken(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
  },
  
  /**
   * 获取用户名
   */
  getUsername(): string | null {
    return localStorage.getItem("alist_username");
  },

  /**
   * 登录获取 Token
   */
  async login(username: string, password: string): Promise<string> {
    const response = await fetch(`${ALIST_CONFIG.HOST}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const data: LoginResponse = await response.json();

    if (data.code === 200 && data.data.token) {
      localStorage.setItem(TOKEN_KEY, data.data.token);
      localStorage.setItem("alist_username", username);
      window.dispatchEvent(new Event("alist-login"));
      return data.data.token;
    } else {
      throw new Error(data.message || "登录失败");
    }
  },

  /**
   * 注销
   */
  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("alist_username");
    window.dispatchEvent(new Event("alist-logout"));
  },

  /**
   * 获取上传路径
   */
  getUploadPath(filename: string, type: "img" | "video" | "audio"): string {
    let subDir = ALIST_CONFIG.OSS_PATH_IMG;
    if (type === "video") subDir = ALIST_CONFIG.OSS_PATH_VIDEO;
    if (type === "audio") subDir = ALIST_CONFIG.OSS_PATH_AUDIO;

    // 路径结构: /alisoss/api.sitkin.top/images/filename
    // 注意处理路径分隔符，避免双斜杠
    const path = `${ALIST_CONFIG.FILE_OSS_PATH}${ALIST_CONFIG.OSS_PATH}${subDir}/${filename}`;
    return path.replace(/\/+/g, "/"); // 简单的去重斜杠
  },

  /**
   * 生成公开访问 URL
   */
  getPublicUrl(filename: string, type: "img" | "video" | "audio"): string {
    let subDir = ALIST_CONFIG.OSS_PATH_IMG;
    if (type === "video") subDir = ALIST_CONFIG.OSS_PATH_VIDEO;
    if (type === "audio") subDir = ALIST_CONFIG.OSS_PATH_AUDIO;

    // URL 结构: https://sitkin-cdn.../api.sitkin.top/images/filename
    const url = `${ALIST_CONFIG.OSS_URL}${ALIST_CONFIG.OSS_PATH}${subDir}/${filename}`;
    // OSS_URL通常带协议头，所以这里的替换要把协议头保护好，或者只替换后半部分的双斜杠
    // 简单起见，假设配置都比较规范，只修正连接处的斜杠
    // 这里简单处理：确保连接处只有一个斜杠 (除了协议后的 //)
    return url.replace(/([^:])\/\//g, "$1/");
  },

  /**
   * 获取指定类型目录的完整路径
   */
  getDirectoryPath(type: "img" | "video" | "audio"): string {
    let subDir = ALIST_CONFIG.OSS_PATH_IMG;
    if (type === "video") subDir = ALIST_CONFIG.OSS_PATH_VIDEO;
    if (type === "audio") subDir = ALIST_CONFIG.OSS_PATH_AUDIO;

    const path = `${ALIST_CONFIG.FILE_OSS_PATH}${ALIST_CONFIG.OSS_PATH}${subDir}`;
    return path.replace(/\/+/g, "/");
  },

  /**
   * 列出指定目录下的文件
   */
  async listFiles(
    type: "img" | "video" | "audio",
    refresh = false
  ): Promise<AlistFileItem[]> {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      throw new Error("请先登录");
    }

    const dirPath = this.getDirectoryPath(type);

    const response = await fetch(`${ALIST_CONFIG.HOST}/api/fs/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify({
        path: dirPath,
        password: "",
        page: 1,
        per_page: 0, // 0 表示不分页，返回全部
        // refresh=true 时强制 Alist 重新索引目录，避免返回旧缓存
        refresh,
      }),
    });

    const data: ListResponse = await response.json();

    if (data.code === 200) {
      return data.data.content || [];
    } else {
      throw new Error(data.message || "获取文件列表失败");
    }
  },

  /**
   * 根据文件名和类型生成公开访问 URL
   */
  getPublicUrlByName(filename: string, type: "img" | "video" | "audio"): string {
    return this.getPublicUrl(filename, type);
  },

  /**
   * 轮询等待异步上传任务完成
   */
  async waitForUploadTask(taskId: string): Promise<void> {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    for (let i = 0; i < MAX_POLL_COUNT; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

      const response = await fetch(
        `${ALIST_CONFIG.HOST}/api/task/upload/info?tid=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: token } }
      );
      const data: TaskInfoResponse = await response.json();

      if (data.code !== 200) break;

      const { state } = data.data;
      // 成功
      if (state === 2) return;
      // 取消或失败
      if (state === 3 || state === 4) {
        throw new Error(data.data.error || "上传任务失败");
      }
      // 其余状态（0等待/1运行中/5等待重试/6重试中）继续轮询
    }
  },

  /**
   * 上传文件
   * 小文件（< 10MB）同步上传，完成即可刷新列表；
   * 大文件使用 As-Task 异步上传，轮询任务状态后再返回。
   */
  async uploadFile(file: File, type: "img" | "video" | "audio"): Promise<string> {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      throw new Error("请先登录");
    }

    const isLargeFile = file.size > ASYNC_UPLOAD_THRESHOLD;
    const filePath = this.getUploadPath(file.name, type);
    const encodedFilePath = encodeURIComponent(filePath);

    const response = await fetch(`${ALIST_CONFIG.HOST}/api/fs/put`, {
      method: "PUT",
      headers: {
        Authorization: token,
        "File-Path": encodedFilePath,
        "Content-Type": file.type || "application/octet-stream",
        // 大文件才使用异步任务，小文件同步上传以便立即刷新
        ...(isLargeFile ? { "As-Task": "true" } : {}),
      },
      body: file,
    });

    const data: UploadResponse = await response.json();

    if (data.code === 200) {
      // 大文件异步任务：等待任务真正完成后再返回
      if (isLargeFile && data.data?.task?.id) {
        await this.waitForUploadTask(data.data.task.id);
      }
      return this.getPublicUrl(file.name, type);
    } else {
      throw new Error(data.message || "上传失败");
    }
  },
};
