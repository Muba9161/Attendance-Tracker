import { StoredDisplayCredentials } from "./storage";

export function getDisplayApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) {
    throw new DisplayApiError(
      "Display API is not configured. Set NEXT_PUBLIC_API_URL to the API origin.",
      "ERR_API_NOT_CONFIGURED"
    );
  }

  try {
    const url = new URL(configured);
    if ((url.protocol !== "http:" && url.protocol !== "https:") ||
        url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new DisplayApiError(
      "NEXT_PUBLIC_API_URL must be a valid HTTP(S) API origin.",
      "ERR_API_NOT_CONFIGURED"
    );
  }
}

export interface PairResponse {
  success: boolean;
  displayId: string;
  terminalId: string;
  credential: string;
  name: string;
  location: string;
  code?: string;
  message?: string;
}

export interface QrTokenResponse {
  success: boolean;
  token: string;
  qrPayload: string;
  displayId: string;
  terminalId: string;
  issuedAt: string;
  expiresAt: string;
  rotationSeconds: number;
  ttlSeconds: number;
  serverTime: number;
  code?: string;
  message?: string;
}

export class DisplayApiError extends Error {
  public code?: string;
  public status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "DisplayApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Pairs a physical display terminal with a one-time pairing code
 */
export async function pairDisplayTerminal(pairingCode: string): Promise<PairResponse> {
  // Preserve the entered code; the backend owns canonicalization. Trim only
  // accidental whitespace around it before sending the one-time credential.
  const cleanCode = pairingCode.trim();
  const url = `${getDisplayApiBaseUrl()}/api/displays/pair`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pairingCode: cleanCode }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.success) {
    throw new DisplayApiError(
      data.message || data.error?.message || data.error || "Failed to pair display terminal",
      data.code,
      res.status
    );
  }

  return {
    success: true,
    displayId: data.displayId || data.terminalId,
    terminalId: data.terminalId || data.displayId,
    credential: data.credential,
    name: data.name || "Office Display",
    location: data.location || "Office Lobby",
  };
}

/**
 * Requests a new rotating challenge token for an authorized display
 */
export async function fetchRotatingChallenge(
  creds: StoredDisplayCredentials
): Promise<QrTokenResponse> {
  const url = `${getDisplayApiBaseUrl()}/api/displays/token`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-display-id": creds.displayId || creds.terminalId,
        "x-display-credential": creds.credential,
        "x-terminal-id": creds.displayId || creds.terminalId,
        "x-terminal-secret": creds.credential,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new DisplayApiError(
        data.message || "Failed to fetch QR challenge",
        data.code,
        res.status
      );
    }

    return data as QrTokenResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export interface DisplayUpdateCheckResult {
  updateAvailable: boolean;
  forceUpdate: boolean;
  latestVersion?: string;
  notes?: string;
}

export async function checkDisplayUpdate(currentVersion = "1.0.0"): Promise<DisplayUpdateCheckResult> {
  try {
    const res = await fetch(`${getDisplayApiBaseUrl()}/api/updates/check?platform=DISPLAY&version=${currentVersion}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { updateAvailable: false, forceUpdate: false };
    const data = await res.json();
    return {
      updateAvailable: !!data.updateAvailable,
      forceUpdate: !!data.forceUpdate,
      latestVersion: data.latestVersion,
      notes: data.notes,
    };
  } catch {
    return { updateAvailable: false, forceUpdate: false };
  }
}
