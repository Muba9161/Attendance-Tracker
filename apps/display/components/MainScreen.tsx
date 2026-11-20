"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { io, Socket } from "socket.io-client";
import { StoredDisplayCredentials, clearStoredCredentials } from "../lib/storage";
import { fetchRotatingChallenge, getDisplayApiBaseUrl, DisplayApiError, QrTokenResponse, checkDisplayUpdate } from "../lib/api";
import { getRefreshRetryDelay, isNewerChallenge, scheduleExpiryRefresh, shouldRefreshOnSocketConnect } from "../lib/qrRefresh";
import { AnnouncementTicker } from "./AnnouncementTicker";
import { CountdownRing } from "./CountdownRing";
import { VORLDX_LOGO_URI } from "../lib/logo";
import {
  Wifi,
  ShieldAlert,
  Clock,
  RotateCw,
  LogOut,
  Sparkles,
  AlertTriangle,
  QrCode,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { SocketEvent, TerminalStatus, type AttendanceDisplayConfirmationPayload } from "@vorldx/shared";

interface MainScreenProps {
  creds: StoredDisplayCredentials;
  onUnpair: () => void;
}

type TerminalState = "ACTIVE" | "DISABLED" | "REVOKED" | "INITIALIZING";

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

interface WakeLockManagerLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

function isWakeLockManager(value: unknown): value is WakeLockManagerLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "request" in value &&
    typeof value.request === "function"
  );
}

// The API owns the QR rotation policy. This fallback matches its default.
const DEFAULT_ROTATION_CADENCE_SECONDS = 30;
const ATTENDANCE_CONFIRMATION_MS = 5_000;

export const MainScreen: React.FC<MainScreenProps> = ({ creds, onUnpair }) => {
  const [tokenData, setTokenData] = useState<QrTokenResponse | null>(null);
  const [terminalState, setTerminalState] = useState<TerminalState>("INITIALIZING");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [showUnpairConfirm, setShowUnpairConfirm] = useState<boolean>(false);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [rotationSeconds, setRotationSeconds] = useState<number>(DEFAULT_ROTATION_CADENCE_SECONDS);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(DEFAULT_ROTATION_CADENCE_SECONDS);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [isRotating, setIsRotating] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");
  const [pendingUpdate, setPendingUpdate] = useState<{ version: string; notes?: string } | null>(null);
  const [isQuietUpdating, setIsQuietUpdating] = useState<boolean>(false);
  const [attendanceConfirmationQueue, setAttendanceConfirmationQueue] = useState<
    Array<AttendanceDisplayConfirmationPayload & { confirmationId: string }>
  >([]);

  const socketRef = useRef<Socket | null>(null);
  const isFetchingRef = useRef<boolean>(false);
  const tokenDataRef = useRef<QrTokenResponse | null>(null);
  const lastPunchRef = useRef<number>(Date.now());
  const serverOffsetRef = useRef<number | null>(null);
  const expiryClientTimeRef = useRef<number | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshClientTimeRef = useRef<number | null>(null);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotationTimerRef = useRef<number | null>(null);
  const refreshAfterExpiryRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef<boolean>(false);
  const initialChallengeRequestedRef = useRef<boolean>(false);
  const hasConnectedOnceRef = useRef<boolean>(false);
  const seenConfirmationIdsRef = useRef<Set<string>>(new Set());
  tokenDataRef.current = tokenData;
  const rotationSecondsRef = useRef(rotationSeconds);
  rotationSecondsRef.current = rotationSeconds;
  const activeAttendanceConfirmation = attendanceConfirmationQueue[0] || null;

  useEffect(() => {
    if (!activeAttendanceConfirmation) return;
    const confirmationId = activeAttendanceConfirmation.confirmationId;
    const timer = window.setTimeout(() => {
      setAttendanceConfirmationQueue((queue) =>
        queue[0]?.confirmationId === confirmationId ? queue.slice(1) : queue
      );
    }, ATTENDANCE_CONFIRMATION_MS);
    return () => window.clearTimeout(timer);
  }, [activeAttendanceConfirmation?.confirmationId]);

  useEffect(() => {
    mountedRef.current = true;
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("resize", updateViewport);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
  }, []);

  // 1. Screen Wake Lock API (keeps kiosk screen awake without screensaver or dimming)
  useEffect(() => {
    let wakeLockSentinel: WakeLockSentinelLike | null = null;

    const requestWakeLock = async () => {
      try {
        if (typeof navigator !== "undefined") {
          const wakeLock = Reflect.get(navigator, "wakeLock");
          if (isWakeLockManager(wakeLock)) {
            wakeLockSentinel = await wakeLock.request("screen");
          }
        }
      } catch {
        // Wake lock might be unavailable or denied in non-secure local previews
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, []);

  // 2. Live wall-clock updater (Subtle clock & date)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );
      setCurrentDate(
        now.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const scheduleChallengeExpiry = useCallback((deadline: number) => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    expiryClientTimeRef.current = deadline;
    expiryTimerRef.current = scheduleExpiryRefresh(deadline, () => {
      if (expiryClientTimeRef.current !== deadline || Date.now() < deadline) return;
      expiryClientTimeRef.current = null;
      refreshClientTimeRef.current = null;
      setTokenData(null);
      tokenDataRef.current = null;
      setRemainingSeconds(0);
      setIsReconnecting(true);
      setStatusMessage("This QR has expired. Loading a fresh attendance code...");
      setTerminalState("INITIALIZING");
      // The cadence timer is an optimization. Expiry itself must always recover
      // via REST, including after browser timer throttling or a missed cadence.
      refreshAfterExpiryRef.current?.();
    });
  }, []);

  // 3. Challenge Fetcher; expiry is based on the server's clock and expiresAt.
  const requestNewChallenge = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    const requestStartedAt = Date.now();
    try {
      const response = await fetchRotatingChallenge(creds);
      if (!mountedRef.current) return;

      const currentIssuedAt = Date.parse(tokenDataRef.current?.issuedAt || "");
      if (Number.isFinite(currentIssuedAt) && !isNewerChallenge(response.issuedAt, tokenDataRef.current?.issuedAt) &&
          response.token !== tokenDataRef.current?.token) return;

      const receivedAt = Date.now();
      const expiryServerTime = Date.parse(response.expiresAt);
      if (!Number.isFinite(expiryServerTime) || !Number.isFinite(response.serverTime)) {
        throw new DisplayApiError("The attendance service returned an invalid QR expiry.", "ERR_INVALID_QR_RESPONSE", 502);
      }
      const measuredOffset = response.serverTime - (requestStartedAt + receivedAt) / 2;
      const clientExpiry = expiryServerTime - measuredOffset;
      if (clientExpiry <= receivedAt || !response.qrPayload) {
        throw new DisplayApiError("The attendance service returned an expired QR challenge.", "ERR_INVALID_QR_RESPONSE", 502);
      }

      setIsRotating(true);
      setTokenData(response);
      tokenDataRef.current = response;
      setTerminalState("ACTIVE");
      setStatusMessage("");
      setIsReconnecting(false);
      serverOffsetRef.current = measuredOffset;
      scheduleChallengeExpiry(clientExpiry);
      const cadenceSeconds = response.rotationSeconds || DEFAULT_ROTATION_CADENCE_SECONDS;
      setRotationSeconds(cadenceSeconds);
      setRemainingSeconds(Math.max(0, (clientExpiry - receivedAt) / 1000));
      const issuedAt = Date.parse(response.issuedAt);
      const clientIssuedAt = Number.isFinite(issuedAt) ? issuedAt - measuredOffset : receivedAt;
      refreshClientTimeRef.current = clientIssuedAt + cadenceSeconds * 1000;
      retryCountRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      // Smooth visual rotation transition
      if (rotationTimerRef.current !== null) window.clearTimeout(rotationTimerRef.current);
      rotationTimerRef.current = window.setTimeout(() => {
        rotationTimerRef.current = null;
        setIsRotating(false);
      }, 300);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      // A refresh failure must not throw away a QR that is still within its
      // server-issued validity window. Its existing expiry timer remains the
      // authority for when it must be blanked.
      refreshClientTimeRef.current = null;
      const hasUsableCurrentQr = Boolean(
        tokenDataRef.current?.qrPayload &&
        expiryClientTimeRef.current !== null &&
        Date.now() < expiryClientTimeRef.current
      );
      if (err instanceof DisplayApiError) {
        if (
          err.code === "ERR_DISPLAY_REVOKED" ||
          err.code === "ERR_TERMINAL_UNAUTHORIZED" ||
          err.status === 401
        ) {
          clearStoredCredentials();
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
          setTokenData(null); // Blank QR immediately
          tokenDataRef.current = null;
          expiryClientTimeRef.current = null;
          setTerminalState("REVOKED");
          setIsReconnecting(false);
          setStatusMessage("This display terminal has been revoked by an administrator.");
        } else if (err.code === "ERR_DISPLAY_DISABLED") {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
          setTokenData(null); // Blank QR immediately
          tokenDataRef.current = null;
          expiryClientTimeRef.current = null;
          setTerminalState("DISABLED");
          setIsReconnecting(false);
          setStatusMessage("This display terminal is currently disabled by HR.");
        } else {
          if (!hasUsableCurrentQr) {
            setTokenData(null);
            tokenDataRef.current = null;
            expiryClientTimeRef.current = null;
            setTerminalState("INITIALIZING");
          }
          setIsReconnecting(true);
          const reason = err.status
            ? `HTTP ${err.status}${err.code ? ` (${err.code})` : ""}`
            : err.code || "request failed";
          setStatusMessage(
            hasUsableCurrentQr
              ? `QR refresh failed (${reason}). The current code remains valid; retrying automatically...`
              : `QR could not be loaded (${reason}). Retrying automatically...`
          );
        }
      } else {
        if (!hasUsableCurrentQr) {
          setTokenData(null);
          tokenDataRef.current = null;
          expiryClientTimeRef.current = null;
          setTerminalState("INITIALIZING");
        }
        setIsReconnecting(true);
        setStatusMessage(
          hasUsableCurrentQr
            ? "QR refresh failed because the attendance service is temporarily unavailable. The current code remains valid; retrying automatically..."
            : "The attendance service is temporarily unavailable. Retrying automatically..."
        );
      }

      if (!(err instanceof DisplayApiError) ||
        (err.code !== "ERR_DISPLAY_REVOKED" &&
          err.code !== "ERR_TERMINAL_UNAUTHORIZED" &&
          err.code !== "ERR_DISPLAY_DISABLED" &&
          err.status !== 401)) {
        retryCountRef.current += 1;
        const delay = getRefreshRetryDelay(retryCountRef.current);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          void requestNewChallenge();
        }, delay);
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, [creds, scheduleChallengeExpiry]);

  // Expiry callbacks are registered before the fetcher callback is assigned.
  // Keep the latest fetcher available without coupling timer setup to its identity.
  refreshAfterExpiryRef.current = () => { void requestNewChallenge(); };

  // 4. Update from server-derived expiry and request a fresh QR at the server cadence.
  useEffect(() => {
    const updateCountdown = () => {
      const deadline = expiryClientTimeRef.current;
      const now = Date.now();
      if (deadline !== null) {
        const secondsLeft = Math.max(0, (deadline - now) / 1000);
        setRemainingSeconds(secondsLeft);
        if (secondsLeft <= 0 && tokenDataRef.current) {
          const expiredDeadline = deadline;
          expiryClientTimeRef.current = null;
          refreshClientTimeRef.current = null;
          if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
          expiryTimerRef.current = null;
          setTokenData(null);
          tokenDataRef.current = null;
          setIsReconnecting(true);
          setStatusMessage("This QR has expired. Loading a fresh attendance code...");
          if (terminalState === "ACTIVE") setTerminalState("INITIALIZING");
          if (expiredDeadline === deadline) refreshAfterExpiryRef.current?.();
        }
      }

      const refreshAt = refreshClientTimeRef.current;
      if (refreshAt !== null && now >= refreshAt && !isFetchingRef.current && terminalState === "ACTIVE") {
        refreshClientTimeRef.current = null;
        void requestNewChallenge();
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 200);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") updateCountdown();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [requestNewChallenge, terminalState]);

  // 5. Socket.IO Integration with auto-reconnection and event isolation
  useEffect(() => {
    let wsUrl: string;
    try {
      // Socket.IO derives ws/wss from the configured HTTP(S) API origin.
      wsUrl = getDisplayApiBaseUrl();
    } catch (error) {
      setIsConnected(false);
      setIsReconnecting(false);
      setStatusMessage(error instanceof Error ? error.message : "Configure NEXT_PUBLIC_API_URL for this display.");
      return;
    }

    const socket = io(wsUrl, {
      auth: {
        terminalId: creds.terminalId || creds.displayId,
        displayId: creds.displayId || creds.terminalId,
        credential: creds.credential,
        terminalSecret: creds.credential,
      },
      transports: ["websocket", "polling"],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 4000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);

      // Resync state, but avoid rotating a healthy REST-fetched challenge on
      // every socket reconnect. REST refresh and expiry recovery are independent.
      socket.emit(SocketEvent.RESYNC, { type: "display" });
      const deadline = expiryClientTimeRef.current;
      const challengeNeedsRefresh = shouldRefreshOnSocketConnect(
        Boolean(tokenDataRef.current?.qrPayload), deadline, Date.now(), Boolean(retryTimerRef.current)
      );
      if (challengeNeedsRefresh && !retryTimerRef.current &&
          (hasConnectedOnceRef.current || !initialChallengeRequestedRef.current)) {
        initialChallengeRequestedRef.current = true;
        requestNewChallenge();
      }
      hasConnectedOnceRef.current = true;
    });

    socket.on("disconnect", (reason) => {
      setIsConnected(false);
      if (reason === "io server disconnect") {
        socket.connect();
      }
    });

    socket.on("connect_error", () => {
      setIsConnected(false);
    });

    // Handle token rotation broadcast from backend
  const handleQrRotated = (data: QrTokenResponse) => {
      const receivedAt = Date.now();
      const expiryServerTime = Date.parse(data?.expiresAt || "");
      const serverTime = Number(data?.serverTime);
      const measuredOffset = serverOffsetRef.current ?? serverTime - receivedAt;
      const clientExpiry = expiryServerTime - measuredOffset;
      const currentIssuedAt = Date.parse(tokenDataRef.current?.issuedAt || "");
      if (Number.isFinite(currentIssuedAt) && !isNewerChallenge(data?.issuedAt || "", tokenDataRef.current?.issuedAt) &&
          data?.token !== tokenDataRef.current?.token) return;
      if (data && data.qrPayload && Number.isFinite(expiryServerTime) && clientExpiry > receivedAt) {
        setIsRotating(true);
        setTokenData(data);
        tokenDataRef.current = data;
        setTerminalState("ACTIVE");
        setStatusMessage("");
        setIsReconnecting(false);
        serverOffsetRef.current = measuredOffset;
        scheduleChallengeExpiry(clientExpiry);
        const cadenceSeconds = data.rotationSeconds || rotationSecondsRef.current;
        setRemainingSeconds(Math.max(0, (clientExpiry - receivedAt) / 1000));
        const issuedAt = Date.parse(data.issuedAt);
        refreshClientTimeRef.current = (Number.isFinite(issuedAt) ? issuedAt - measuredOffset : receivedAt) + cadenceSeconds * 1000;
        retryCountRef.current = 0;
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      if (rotationTimerRef.current !== null) window.clearTimeout(rotationTimerRef.current);
      rotationTimerRef.current = window.setTimeout(() => {
        rotationTimerRef.current = null;
        setIsRotating(false);
      }, 300);
      }
    };

    socket.on(SocketEvent.QR_ROTATED, handleQrRotated);
    socket.on(SocketEvent.QR_TOKEN_ROTATE, handleQrRotated);

    // Handle display status changes (Disabled / Revoked / Activated)
    // RULE: Revoked or disabled state blanks the QR immediately
    const handleDisplayStatus = (data: {
      terminalId: string;
      isActive: boolean;
      status: string;
      message?: string;
    }) => {
      const isOurTerminal =
        data.terminalId === creds.terminalId || data.terminalId === creds.displayId;
      if (!isOurTerminal) return;

      if (data.status === TerminalStatus.REVOKED || data.status === "REVOKED") {
        clearStoredCredentials();
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
      if (rotationTimerRef.current !== null) window.clearTimeout(rotationTimerRef.current);
        retryTimerRef.current = null;
        expiryTimerRef.current = null;
        refreshClientTimeRef.current = null;
        setTokenData(null); // Blanks QR immediately
        tokenDataRef.current = null;
        expiryClientTimeRef.current = null;
        setTerminalState("REVOKED");
        setStatusMessage(data.message || "Display terminal revoked. All issued challenges invalidated.");
      } else if (!data.isActive || data.status === TerminalStatus.DISABLED || data.status === "DISABLED") {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
        retryTimerRef.current = null;
        expiryTimerRef.current = null;
        refreshClientTimeRef.current = null;
        setTokenData(null); // Blanks QR immediately
        tokenDataRef.current = null;
        expiryClientTimeRef.current = null;
        setTerminalState("DISABLED");
        setStatusMessage(
          data.message || "Display temporarily disabled by administrator. Contact HR to re-enable."
        );
      } else if (data.isActive && (data.status === TerminalStatus.ACTIVE || data.status === "ACTIVE")) {
        setTerminalState("ACTIVE");
        setStatusMessage("");
        requestNewChallenge();
      }
    };

    socket.on(SocketEvent.DISPLAY_STATUS, handleDisplayStatus);
    socket.on(SocketEvent.TERMINAL_STATUS_CHANGED, handleDisplayStatus);

    const handleReleasePublished = (data: { platform: string; version: string; notes?: string }) => {
      if (data.platform === "DISPLAY" || data.platform === "ALL") {
        setPendingUpdate({ version: data.version, notes: data.notes });
      }
    };
    socket.on(SocketEvent.APP_RELEASE_PUBLISHED, handleReleasePublished);
    const handleAttendancePunch = () => {
      lastPunchRef.current = Date.now();
    };
    const handleAnnouncementUpdate = () => {
      window.dispatchEvent(new Event("display:announcement-update"));
    };
    socket.on(SocketEvent.ATTENDANCE_PUNCHED, handleAttendancePunch);
    socket.on(SocketEvent.ATTENDANCE_UPDATED, handleAttendancePunch);
    const handleAttendanceConfirmation = (data: AttendanceDisplayConfirmationPayload) => {
      if (
        !data ||
        (data.terminalId !== creds.terminalId && data.terminalId !== creds.displayId) ||
        !data.employeeName ||
        !data.maskedEmployeeId ||
        !["CHECK_IN", "CHECK_OUT"].includes(data.punchType) ||
        !Number.isFinite(Date.parse(data.timestamp))
      ) return;

      const confirmationId = `${data.recordId}:${data.punchType}:${data.timestamp}`;
      if (seenConfirmationIdsRef.current.has(confirmationId)) return;
      seenConfirmationIdsRef.current.add(confirmationId);
      setAttendanceConfirmationQueue((queue) => [...queue, { ...data, confirmationId }]);
    };
    socket.on(SocketEvent.ATTENDANCE_DISPLAY_CONFIRMATION, handleAttendanceConfirmation);
    socket.on("announcement.published", handleAnnouncementUpdate);
    socket.on("announcement.pinned", handleAnnouncementUpdate);

    // Heartbeat every 25s
    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit(SocketEvent.DISPLAY_HEARTBEAT, { terminalId: creds.terminalId });
      }
    }, 25000);

    return () => {
      clearInterval(heartbeatInterval);
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off(SocketEvent.QR_ROTATED, handleQrRotated);
      socket.off(SocketEvent.QR_TOKEN_ROTATE, handleQrRotated);
      socket.off(SocketEvent.DISPLAY_STATUS, handleDisplayStatus);
      socket.off(SocketEvent.TERMINAL_STATUS_CHANGED, handleDisplayStatus);
      socket.off(SocketEvent.APP_RELEASE_PUBLISHED, handleReleasePublished);
      socket.off(SocketEvent.ATTENDANCE_PUNCHED, handleAttendancePunch);
      socket.off(SocketEvent.ATTENDANCE_UPDATED, handleAttendancePunch);
      socket.off(SocketEvent.ATTENDANCE_DISPLAY_CONFIRMATION, handleAttendanceConfirmation);
      socket.off("announcement.published", handleAnnouncementUpdate);
      socket.off("announcement.pinned", handleAnnouncementUpdate);
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [creds, requestNewChallenge, scheduleChallengeExpiry]);

  // 6. Periodic Display Version Poll
  useEffect(() => {
    let isMounted = true;
    const checkVersion = async () => {
      const res = await checkDisplayUpdate("1.0.0");
      if (isMounted && res.updateAvailable && res.latestVersion) {
        setPendingUpdate({ version: res.latestVersion, notes: res.notes });
      }
    };
    checkVersion();
    const interval = setInterval(checkVersion, 1000 * 60 * 2);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // 7. Safe Quiet-Moment Auto-Reload (reloads only when idle >= 30s with zero punch activity)
  useEffect(() => {
    if (!pendingUpdate || isQuietUpdating) return;

    const quietInterval = setInterval(() => {
      const idleSeconds = (Date.now() - lastPunchRef.current) / 1000;
      if (idleSeconds >= 30 && terminalState === "ACTIVE") {
        setIsQuietUpdating(true);
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    }, 5000);

    return () => clearInterval(quietInterval);
  }, [pendingUpdate, isQuietUpdating, terminalState]);

  // Initial challenge fetch
  useEffect(() => {
    if (!initialChallengeRequestedRef.current) {
      initialChallengeRequestedRef.current = true;
      requestNewChallenge();
    }
  }, [requestNewChallenge]);

  const handleManualUnpair = () => {
    setShowUnpairConfirm(true);
  };

  const confirmUnpair = () => {
    setShowUnpairConfirm(false);
    clearStoredCredentials();
    onUnpair();
  };

  const shouldRenderQR = Boolean(
    tokenData?.qrPayload &&
      expiryClientTimeRef.current !== null &&
      Date.now() < expiryClientTimeRef.current &&
      terminalState !== "REVOKED" &&
      terminalState !== "DISABLED"
  );
  const qrSize = Math.max(
    180,
    Math.floor(Math.min(420, viewport.width - 64, viewport.height * 0.46))
  );
  const logoSize = Math.round(qrSize * 0.158);

  // Optional slim announcement ticker flag (defaults to true unless explicitly disabled)
  const isAnnouncementTickerEnabled = process.env.NEXT_PUBLIC_ENABLE_ANNOUNCEMENT_TICKER !== "false";

  return (
    <div
      className="min-h-[100svh] w-full flex flex-col justify-between gap-4 p-3 sm:gap-5 sm:p-6 md:p-8 bg-brand-950 text-slate-100 select-none overflow-x-hidden relative"
      role="region"
      aria-label="VorldX Attendance Kiosk"
    >
      {/* Background Ambience Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-gradient-to-tr from-cyan-600/10 via-blue-600/10 to-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* TOP TELEMETRY BAR: Display Name, Subtle Clock, Small Authorization Badge & Live Connection */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        {/* Left: Branding & Display Name */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 via-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
            <QrCode className="w-5 h-5 text-white" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span aria-label="VORLDX" className="text-xl font-black tracking-tight text-[#147FB5]">
                VORLD<span className="text-[#62666B]">X</span>
              </span>
              {/* Small Authorization Badge */}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold tracking-wide uppercase">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>Authorized Kiosk</span>
              </span>
            </div>

            <p className="text-[10px] sm:text-xs font-semibold tracking-[0.12em] text-slate-300 uppercase leading-tight">
              INDUSTRIES PRIVATE LIMITED
            </p>

            <p id="display-terminal-name" className="text-[11px] sm:text-xs text-slate-400 font-medium truncate max-w-[55vw] sm:max-w-md mt-0.5">
              {creds.name || "Office Display"} • <span className="text-slate-500">{creds.location || "Office Lobby"}</span>
            </p>
          </div>
        </div>

        {/* Right: Subtle Clock, Date & Calm Network Status Indicator */}
        <div className="flex items-center gap-4">
          {/* Subtle Clock and Date */}
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-sm font-mono font-bold text-slate-300 tracking-wider tabular-nums">
              {currentTime}
            </span>
            <span className="text-[11px] text-slate-500 font-medium tracking-wide">
              {currentDate}
            </span>
          </div>

          {/* Connection Status Pill */}
          <div
            id="connection-status-pill"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
              isConnected
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
            }`}
          >
            {isConnected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span>Online</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <RotateCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                <span>{isConnected ? (isReconnecting ? "Refreshing QR" : "Online") : "Reconnecting"}</span>
              </>
            )}
          </div>

          {/* Unpair Trigger Button */}
          <button
            type="button"
            id="unpair-kiosk-btn"
            onClick={handleManualUnpair}
            title="Unpair Display Terminal"
            aria-label="Unpair this terminal"
            className="p-2 rounded-xl bg-slate-800/60 border border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* CENTER STAGE: Very Large High-Contrast QR Code with Centered Company Logo */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center py-2 sm:py-3 text-center">
        {/* STATE 1: ACTIVE OR CALM RECONNECTING (QR is kept mounted) */}
        {activeAttendanceConfirmation && (
          <div
            key={activeAttendanceConfirmation.confirmationId}
            data-testid="attendance-success-confirmation"
            role="status"
            aria-live="polite"
            className="w-full max-w-xl rounded-3xl border border-emerald-400/30 bg-brand-900/90 p-8 sm:p-10 text-center shadow-2xl glow-cyan animate-fade-in"
          >
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-300">Attendance Recorded</p>
            <h1 className="mt-2 text-3xl sm:text-4xl font-black text-white">Thank You!</h1>
            <p className="mt-5 text-xl font-semibold text-slate-100">
              {activeAttendanceConfirmation.employeeName}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Employee ID: {activeAttendanceConfirmation.maskedEmployeeId}
            </p>
            <div className="mt-6 inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-5 py-2 text-sm font-bold tracking-widest text-cyan-200">
              {activeAttendanceConfirmation.punchType === "CHECK_IN" ? "CHECK-IN" : "CHECK-OUT"}
            </div>
            <p className="mt-4 text-sm text-slate-300">
              {new Date(activeAttendanceConfirmation.timestamp).toLocaleTimeString("en-IN", {
                hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
                timeZone: activeAttendanceConfirmation.timeZone,
              })}
            </p>
            {attendanceConfirmationQueue.length > 1 && (
              <p className="mt-4 text-xs text-slate-500">
                {attendanceConfirmationQueue.length - 1} more confirmation{attendanceConfirmationQueue.length === 2 ? "" : "s"} queued
              </p>
            )}
          </div>
        )}

        {!activeAttendanceConfirmation && shouldRenderQR && (
          <div className="flex flex-col items-center gap-3 sm:gap-4 animate-fade-in w-full">
            {/* Header Instructions */}
            <div className="space-y-1">
              <h1 className="text-xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white px-2">
                Scan to Record Attendance
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                Hold phone camera steadily in front of the QR code using the VorldX Mobile App
              </p>
            </div>

            {/* VERY LARGE HIGH-CONTRAST QR CODE WITH CENTERED VORLDX LOGO */}
            {/* High error correction and proportionally sized logo preserve the scan area at each viewport size. */}
            <div className="relative flex flex-col items-center justify-center gap-3 lg:flex-row lg:gap-6">
              <div
                id="active-qr-container"
                className={`p-3 sm:p-4 md:p-5 bg-white rounded-3xl shadow-2xl transition-all duration-300 border-4 border-slate-100 glow-cyan ${
                  isRotating ? "scale-[0.99] opacity-90" : "scale-100 opacity-100"
                }`}
              >
                <QRCodeSVG
                  id="vorldx-dynamic-qr-code"
                  value={tokenData?.qrPayload || ""}
                  size={qrSize}
                  level="H" // High error correction level (30% recovery)
                  includeMargin={false}
                  bgColor="#FFFFFF"
                  fgColor="#000000"
                  imageSettings={{
                    src: VORLDX_LOGO_URI,
                    height: logoSize,
                    width: logoSize,
                    excavate: true, // Clean white padded cutout ensuring finder patterns and modules are preserved
                  }}
                  style={{ width: qrSize, height: qrSize }}
                  className="max-w-full transition-transform"
                />
              </div>

              <CountdownRing
                ttlSeconds={tokenData?.ttlSeconds || rotationSeconds}
                remainingSeconds={remainingSeconds}
                size={viewport.width >= 1024 ? 96 : 72}
                className="shrink-0"
              />
            </div>

            {/* Subtle Sub-Badge & Information */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Auto Check-In & Check-Out</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 font-medium">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>Server-Controlled Timestamps</span>
              </span>
            </div>
          </div>
        )}

        {/* INITIALIZING STATE */}
        {!shouldRenderQR && terminalState === "INITIALIZING" && (
          <div className="flex flex-col items-center space-y-4 text-center max-w-md w-full p-6 sm:p-8 rounded-3xl bg-brand-900/60 border border-slate-800/80 backdrop-blur-md animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-lg">
              <RotateCw className="w-8 h-8 animate-spin" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-white tracking-tight">{isReconnecting ? "Reconnecting to Attendance" : "Starting Kiosk Feed"}</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                {statusMessage || "Initializing cryptographic challenge generator and synchronizing with attendance cluster..."}
              </p>
            </div>
          </div>
        )}

        {shouldRenderQR && statusMessage && (
          <p role="status" className="max-w-xl text-center text-xs text-amber-300/90">
            {statusMessage}
          </p>
        )}

        {/* STATE 2: DISABLED BY HR (QR is immediately blanked) */}
        {terminalState === "DISABLED" && (
          <div
            id="display-disabled-screen"
            className="max-w-md w-full p-8 sm:p-10 rounded-3xl bg-brand-900/90 border-2 border-amber-500/40 text-center space-y-5 shadow-2xl backdrop-blur-xl glow-amber animate-fade-in"
            role="alert"
          >
            <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-extrabold text-white">Display Temporarily Disabled</h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                {statusMessage ||
                  "This lobby screen has been disabled by the HR administrator. Please scan on an alternate office terminal or check in with human resources."}
              </p>
            </div>

            <div className="pt-2">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                <span>Awaiting administrative re-enablement...</span>
              </div>
            </div>
          </div>
        )}

        {/* STATE 3: REVOKED BY HR (QR is immediately blanked) */}
        {terminalState === "REVOKED" && (
          <div
            id="display-revoked-screen"
            className="max-w-md w-full p-8 sm:p-10 rounded-3xl bg-brand-900/90 border-2 border-rose-500/40 text-center space-y-5 shadow-2xl backdrop-blur-xl glow-rose animate-fade-in"
            role="alert"
          >
            <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-extrabold text-white">Display Terminal Revoked</h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                {statusMessage ||
                  "Terminal credentials have been permanently revoked and all issued challenges were invalidated. This hardware must be reauthorized with a new pairing code."}
              </p>
            </div>

            <button
              type="button"
              id="re-pair-screen-btn"
              onClick={onUnpair}
              className="mt-4 px-6 py-3 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:opacity-90 font-bold text-sm text-white shadow-lg transition-all"
            >
              Pair New Terminal
            </button>
          </div>
        )}
      </main>

      {/* Optional Slim Announcement Ticker at the Bottom (flagged) */}
      {isAnnouncementTickerEnabled && <AnnouncementTicker />}

      {/* BOTTOM TELEMETRY & PRIVACY GUARANTEE */}
      <footer className="relative z-10 pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="font-medium text-slate-400">
            Brief attendance confirmations show an employee name and masked ID for five seconds.
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>VorldX High-Contrast Display Engine v1.1.0</span>
          {pendingUpdate && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] animate-pulse">
              <RotateCw className="w-2.5 h-2.5 animate-spin" />
              <span>v{pendingUpdate.version} ready (auto-reload at quiet interval)</span>
            </span>
          )}
        </div>
      </footer>

      {/* QUIET MOMENT RE-LOAD OVERLAY */}
      {isQuietUpdating && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <RotateCw className="w-8 h-8 animate-spin" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-xl font-bold text-white">Quiet Interval Detected</h3>
            <p className="text-xs text-slate-400">
              Safely reloading kiosk to apply update v{pendingUpdate?.version || "latest"}...
            </p>
          </div>
        </div>
      )}

      {/* ACCESSIBLE UNPAIR CONFIRMATION DIALOG */}
      {showUnpairConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="region"
          aria-label="Confirmation overlay"
        >
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
            onClick={() => setShowUnpairConfirm(false)}
            aria-hidden="true"
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unpair-dialog-title"
            aria-describedby="unpair-dialog-desc"
            className="relative w-full max-w-md rounded-2xl bg-brand-900 border border-slate-700/80 p-6 shadow-2xl z-10 text-slate-100"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-xl p-3 bg-rose-500/15 border border-rose-500/30 text-rose-400 shrink-0">
                <AlertTriangle className="w-6 h-6" aria-hidden="true" />
              </div>
              <div>
                <h3 id="unpair-dialog-title" className="text-lg font-bold text-white tracking-tight">
                  Unpair Display Terminal?
                </h3>
                <p id="unpair-dialog-desc" className="mt-2 text-sm text-slate-300 leading-relaxed">
                  This will disconnect the kiosk monitor from the active challenge feed. To reconnect, the display will need to be re-paired with an admin registration code.
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowUnpairConfirm(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Keep Paired
              </button>
              <button
                type="button"
                onClick={confirmUnpair}
                className="px-4 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 active:bg-rose-700 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 shadow-sm"
              >
                Unpair Monitor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
