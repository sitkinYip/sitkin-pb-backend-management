export type AdminPushAudience = "allowlist" | "all";

export interface AdminPushSettings {
  audience: AdminPushAudience;
  playerIds: string[];
  revision: number;
  serverEnabled: boolean;
  testMode: boolean;
  subscriptionApproved: boolean;
}

export interface AdminPushSettingsInput {
  requestId: string;
  audience: AdminPushAudience;
  playerIds: string[];
  expectedRevision: number;
  reason: string;
}
