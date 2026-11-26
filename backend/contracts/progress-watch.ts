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
