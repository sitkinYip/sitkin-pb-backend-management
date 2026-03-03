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

// 大文件阈值：超过此大小使用异步任务上传（50MB）
const ASYNC_UPLOAD_THRESHOLD = 50 * 1024 * 1024;

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
   * 后台轮询异步上传任务（非阻塞）
   * 双重检测：
   *   1. 查 done 列表中的 taskId（快速路径）
   *   2. 直接查目录文件列表确认文件是否已出现（可靠兜底）
   * 任一满足即触发 onDone，最长等待 2 分钟后强制触发
   */
  pollUploadTask(
    taskId: string,
    filename: string,
    type: "img" | "video" | "audio",
    onDone: () => void,
    onError: (msg: string) => void
  ): void {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { onDone(); return; }

    const INTERVAL = 3000;  // 3 秒一轮（比之前更温和）
    const MAX = 40;          // 最多 40 轮 = 2 分钟
    let count = 0;

    const poll = async () => {
      if (count++ >= MAX) {
        // 超时仍触发 onDone，让列表刷新一次让用户自行确认
        onDone();
        return;
      }

      try {
        // ── 检测 1：查 done 任务列表 ──────────────────────────────
        const doneRes = await fetch(`${ALIST_CONFIG.HOST}/api/task/upload/done`, {
          headers: { Authorization: token },
        });

        if (doneRes.status === 401) return; // Token 失效，静默退出

        if (doneRes.ok) {
          const doneData = (await doneRes.json()) as {
            code: number;
            data: { id: string; state: number; error: string }[] | null;
          };

          if (doneData.code === 200) {
            const found = (doneData.data ?? []).find((t) => t.id === taskId);
            if (found) {
              if (found.state === 2) { onDone(); return; }
              if (found.state === 3 || found.state === 4) {
                onError(found.error || "异步上传任务失败");
                return;
              }
            }
          }
        }

        // ── 检测 2：直接检查文件是否已出现在目录中（最可靠）──────────
        const files = await this.listFiles(type, true);
        if (files.some((f) => f.name === filename)) {
          onDone();
          return;
        }

        // 两种检测都没命中，继续等待
        setTimeout(poll, INTERVAL);
      } catch {
        setTimeout(poll, INTERVAL);
      }
    };

    // 首次延迟 3 秒再查，给 Alist 时间开始处理
    setTimeout(poll, INTERVAL);
  },

  /**
   * 上传文件
   * 小文件（< 10MB）：同步上传，完成即可刷新列表
   * 大文件：提交 As-Task 后立即返回（不锁住载入状态）
   *   返回的 taskId 不为空时，调用方可用 pollUploadTask 进行后台轮询
   */
  async uploadFile(
    file: File,
    type: "img" | "video" | "audio"
  ): Promise<{ url: string; taskId?: string }> {
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
      const url = this.getPublicUrl(file.name, type);
      // 大文件返回 taskId，由调用方决定是否进行后台轮询
      const taskId = isLargeFile ? data.data?.task?.id : undefined;
      return { url, taskId };
    } else {
      throw new Error(data.message || "上传失败");
    }
  },
};
