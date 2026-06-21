export interface MonitorStatusResponse {
  userId: string;
  date: string;
  eventCount: number;
  lastEventAt: string | null;
  lastDomain: string | null;
  storage: string;
}

export interface ExtensionStatus {
  connected: boolean;
  enabled?: boolean;
  userId?: string;
  pendingCount?: number;
  tracking?: boolean;
  currentDomain?: string | null;
}
