export interface AdminProgressWatch {
  id: string;
  watcher: string;
  assignment: string;
  player: string;
  title: string;
  expiresAt: string;
  revoked: boolean;
  revision: number;
  subscribed: boolean;
  pushEnabled: boolean;
}

export interface AdminProgressWatchList {
  items: AdminProgressWatch[];
}

export type ProgressEventKind = "correct" | "incorrect" | "completed";

export interface ProgressWatch {
  id: string;
  assignmentId: string;
  playerName: string;
  title: string;
  expiresAt: string;
  status: "assigned" | "active" | "completed";
  subscribed: boolean;
  pushEnabled: boolean;
  eventKinds: ProgressEventKind[];
  revision: number;
}

export interface ProgressWatchList {
  items: ProgressWatch[];
}

export interface ProgressAttempt {
  id: string;
  position: number;
  result: "correct" | "incorrect";
  submittedAt: string;
  /** Stored input or choice key. Only present for an incorrect submission in authorized detail. */
  submittedAnswer?: string;
  /** Public label of the selected choice, when available for the submitted key. */
  submittedOptionLabel?: string;
}

export interface ProgressWatchDetail {
  watch: ProgressWatch;
  pushAvailable: boolean;
  solved: number;
  total: number;
  /** One-based position during play. Zero before entry and after completion. */
  currentPosition: number;
  /** ISO timestamp after completion. Empty before completion. */
  completedAt: string;
  recent: ProgressAttempt[];
}

export interface ProgressWatchCommand {
  requestId: string;
  expectedRevision: number;
  subscribed: boolean;
  pushEnabled: boolean;
  eventKinds: ProgressEventKind[];
}
