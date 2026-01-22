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

export const alistService = {
  /**
   * 检查本地是否有 Token
   */
  checkToken(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
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
  },

  /**
   * 获取上传路径
   */
  getUploadPath(filename: string, type: "img" | "video"): string {
    const subDir = type === "img" ? ALIST_CONFIG.OSS_PATH_IMG : ALIST_CONFIG.OSS_PATH_VIDEO;
    // 路径结构: /alisoss/api.sitkin.top/images/filename
    // 注意处理路径分隔符，避免双斜杠
    const path = `${ALIST_CONFIG.FILE_OSS_PATH}${ALIST_CONFIG.OSS_PATH}${subDir}/${filename}`;
    return path.replace(/\/+/g, "/"); // 简单的去重斜杠
  },

  /**
   * 生成公开访问 URL
   */
  getPublicUrl(filename: string, type: "img" | "video"): string {
    const subDir = type === "img" ? ALIST_CONFIG.OSS_PATH_IMG : ALIST_CONFIG.OSS_PATH_VIDEO;
    // URL 结构: https://sitkin-cdn.../api.sitkin.top/images/filename
    const url = `${ALIST_CONFIG.OSS_URL}${ALIST_CONFIG.OSS_PATH}${subDir}/${filename}`;
    // OSS_URL通常带协议头，所以这里的替换要把协议头保护好，或者只替换后半部分的双斜杠
    // 简单起见，假设配置都比较规范，只修正连接处的斜杠
    // 这里简单处理：确保连接处只有一个斜杠 (除了协议后的 //)
    return url.replace(/([^:])\/\//g, "$1/");
  },

  /**
   * 上传文件
   */
  async uploadFile(file: File, type: "img" | "video"): Promise<string> {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      throw new Error("请先登录");
    }

    const filePath = this.getUploadPath(file.name, type);
    // 需要对 file path 进行 URL 编码，根据 API 文档要求: "经过URL编码的完整目标文件路径"
    // encodeURIComponent 会编码 /，这是我们不希望的吗？
    // 文档说 "经过URL编码的完整目标文件路径"，通常指整个路径也是字符串。
    // 这里使用 encodeURI 还是 encodeURIComponent 需要小心。
    // 如果 alist 要求 header 里的 File-Path 是 /test/a.jpg -> %2Ftest%2Fa.jpg，那就用 encodeURIComponent
    // 如果只是文件名编码，那就是 path 部分编码。
    // 参考常见 Alist API 调用，通常 Header 里的 File-Path 需要 encodeURIComponent 整个路径。
    const encodedFilePath = encodeURIComponent(filePath);

    const response = await fetch(`${ALIST_CONFIG.HOST}/api/fs/put`, {
      method: "PUT",
      headers: {
        Authorization: token,
        "File-Path": encodedFilePath,
        "Content-Type": file.type || "application/octet-stream",
        "As-Task": "true", // 添加为任务，避免大文件超时
      },
      body: file,
    });

    const data: UploadResponse = await response.json();

    if (data.code === 200) {
      // 成功后，返回构造好的 CDN URL
      return this.getPublicUrl(file.name, type);
    } else {
      throw new Error(data.message || "上传失败");
    }
  },
};
