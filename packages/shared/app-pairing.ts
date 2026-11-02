export interface AppPairingCode {
  code: string;
  expiresAt: string;
}

export interface AppPairingQr {
  version: 1;
  serverUrl: string;
  code: string;
}

export interface AppPairingRedeemRequest {
  code: string;
  name: string;
}

export interface AppPairingRedeemResponse {
  token: string;
  sessionId: string;
}

export interface AppPushTokenRequest {
  token: string;
  platform: 'ios';
  environment: 'sandbox' | 'production';
  bundleId?: string;
}

export interface AppPushTokenStatus {
  registered: boolean;
  platform?: 'ios';
  environment?: 'sandbox' | 'production';
  bundleId?: string;
  updatedAt?: string;
}

export interface ServerCapabilities {
  api: number;
  auth: {
    via: 'token' | 'session';
    method: 'google' | 'pairing' | null;
    sessionId: string | null;
  };
  pairing: { app: boolean; codeTtlSeconds: number };
  push: { registration: boolean; delivery: boolean };
  streams: { sse: boolean; closeOnRevoke: boolean };
}

export interface ApiError {
  error: string;
}
