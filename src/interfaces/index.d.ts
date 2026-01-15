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
}
