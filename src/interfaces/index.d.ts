export interface OptionItem {
  text?: string;
  img?: string;
  key: string;
  video?: string;
}
export type OptionItemList = OptionItem[];

export interface QuestionItem {
  text?: string;
  tips?: string;
  img?: string;
  video?: string;
  imgList?: string[];
}
export type QuestionItemList = QuestionItem[];

export interface ThreadItem {
  type: "text" | "url" | "img" | "video" | "letter";
  content: string;
  url?: string;
  imgList?: string[];
  state?: "ckickplay" | string;
  path?: string;
  query?: Record<string, string>;
  nextIndex?: number;
  title?: string;
}
export type ThreadItemList = ThreadItem[];

export interface LevelRecord {
  id: string;
  type?: "FillInTheBlank" | "MultipleChoice";
  options?: OptionItemList;
  title?: string;
  step: number;
  question: QuestionItemList;
  answer: string;
  answerList?: string[];
  placeholder: string;
  thread: ThreadItemList;
  userName: string;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
  startTime?: string;
  endTime?: string;
  avatar?: string;
  rankName?: string;
  isFinalLevel?: boolean;
  FinalLevelConfig?: {
    path?: string;
    link?: string;
    query?: Record<string, string>;
  };
  penaltyConfig?: number[];
  /* 背景音乐 */
  mainAudio?: string;
  /* 背景图片 */
  mainBgImg?: string;
}

// 
export interface ParagraphConfig {
  /** 段落文本内容 */
  content: string;
  /** 对齐方式：左、中、右  上 下*/
  align?: "left" | "center" | "right" | "top" | "bottom";
  /** 打字前的延迟时间 (ms) */
  delay?: number;
  /** 关联的音频地址 */
  audio?: string;
}

export type ParagraphConfigList = ParagraphConfig[];

export interface TLetterecord {
  id: string;
  paragraphConfigList: ParagraphConfigList;
  bgImages?: string[];
  from: string;
  type: "modern" | "classical" | "magic";
  created: string;
  updated: string;
  title?: string;
  desc?: string;
  bgImg?: string;
  /* 页面主音频 一般用于当前页面播放背景音乐之类的场景 */
  mainAudio?: string;
  hintText?: string;
}

export interface IphraseItem {
  text: string;
  audio?: string;
  duration?: number;
}

export interface PhraseListRecord {
  id: string;
  phraseList: IphraseItem[];
  takeABowList: IphraseItem[];
  from: string;
  created: string;
  updated: string;
  title?: string;
  /* 页面主音频 一般用于当前页面播放背景音乐之类的场景 */
  mainAudio?: string;
}
