/**
 * ALIST 配置
 * 优先从环境变量 (VITE_ 前缀) 读取，否则使用默认值
 */

export const ALIST_CONFIG = {
  // ALIST 服务地址
  HOST: import.meta.env.VITE_ALIST_OSS_HOST || "https://oss.sitkin.top",
  
  // ALIST 中的 OSS 入口目录
  FILE_OSS_PATH: import.meta.env.VITE_FILE_ALIST_OSS_PATH || "/alisoss/",
  
  // OSS 内部的大目录
  OSS_PATH: import.meta.env.VITE_OSS_PATH || "api.sitkin.top/",
  
  // 图片目录
  OSS_PATH_IMG: import.meta.env.VITE_OSS_PATH_IMG || "images",
  
  // 视频目录
  OSS_PATH_VIDEO: import.meta.env.VITE_OSS_PATH_VIDEO || "video",

  // 音频目录
  OSS_PATH_AUDIO: import.meta.env.VITE_OSS_PATH_AUDIO || "audio",
  
  // 最终访问的 CDN 域名
  OSS_URL: import.meta.env.VITE_OSS_URL || "https://sitkin-cdn.oss-cn-heyuan.aliyuncs.com/",
};
