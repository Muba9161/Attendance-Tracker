import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search,
  RotateCw,
  History,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Calendar,
  CheckCircle2,
  Info,
  Edit3,
} from "lucide-react";
import {
  useAttendanceRecords,
  useCorrectAttendanceRecord,
  useLiveAnalytics,
  AttendanceRecordItem,
  AttendanceFilters,
} from "../api/queries";
import { useSocket } from "../context/SocketContext";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Drawer } from "../components/ui/Drawer";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { useToast } from "../components/ui/Toast";
import { AttendanceStatus } from "@vorldx/shared";
import { useAuth } from "../context/AuthContext";
import { canCorrectAttendance } from "../utils/attendanceCorrectionAccess";
import { useActivePolicy } from "../api/queries";

const dateKeyInTimezone = (timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const AttendanceLedgerPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { info, success } = useToast();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { data: attendancePolicy } = useActivePolicy();
  const canCorrect = canCorrectAttendance(user?.role);

  const prefilledEmployeeId = searchParams.get("employeeId") || "";
  const prefilledStatus = searchParams.get("status") as AttendanceStatus | undefined;
  const defaultDateKey = dateKeyInTimezone(attendancePolicy?.timezone || "Asia/Kolkata");
  const prefilledDateKey = searchParams.get("dateKey") || defaultDateKey;
  const {
    data: liveAnalytics,
    isLoading: departmentsLoading,
    isError: departmentsError,
    refetch: refetchDepartments,
  } = useLiveAnalytics({ dateKey: prefilledDateKey });
  const departments = useMemo(
    () => (liveAnalytics?.departmentBreakdown || []).map((item) => item.department).filter(Boolean),
    [liveAnalytics?.departmentBreakdown]
  );

  // 1. Ledger Filter State
  const [filters, setFilters] = useState<AttendanceFilters>({
    page: 1,
    limit: 10,
    search: prefilledEmployeeId,
    department: "",
    status: prefilledStatus || undefined,
    workType: "",
    dateKey: prefilledDateKey,
    sortBy: "dateKey",
    sortOrder: "desc",
  });

  const [searchInput, setSearchInput] = useState(prefilledEmployeeId);
  const [recentlyUpdatedRowId, setRecentlyUpdatedRowId] = useState<string | null>(null);

  // Synchronize URL search params with filter state if query changes
  useEffect(() => {
    const statusParam = searchParams.get("status") as AttendanceStatus | null;
    const dateKeyParam = searchParams.get("dateKey");
    const empIdParam = searchParams.get("employeeId");

    setFilters((prev) => ({
      ...prev,
      page: 1,
      status: statusParam || undefined,
      dateKey: dateKeyParam || prev.dateKey,
      search: empIdParam !== null ? empIdParam : prev.search,
    }));
    if (empIdParam !== null) {
      setSearchInput(empIdParam);
    }
  }, [searchParams]);

  useEffect(() => {
    const timezone = attendancePolicy?.timezone;
    if (!timezone || searchParams.get("dateKey")) return;
    const policyDateKey = dateKeyInTimezone(timezone);
    setFilters((previous) => previous.dateKey === dateKeyInTimezone("Asia/Kolkata")
      ? { ...previous, dateKey: policyDateKey, page: 1 }
      : previous);
  }, [attendancePolicy?.timezone, searchParams]);

  // 2. Row Details Drawer State
  const [detailRecord, setDetailRecord] = useState<AttendanceRecordItem | null>(null);

  const [correctingRecord, setCorrectingRecord] = useState<AttendanceRecordItem | null>(null);
  const [newStatus, setNewStatus] = useState<AttendanceStatus>(AttendanceStatus.PRESENT);
  const [newCheckInTime, setNewCheckInTime] = useState("");
  const [newCheckOutTime, setNewCheckOutTime] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [showCorrectionConfirm, setShowCorrectionConfirm] = useState(false);
  const correctMutation = useCorrectAttendanceRecord();

  // Read-only correction history state
  const [historyRecord, setHistoryRecord] = useState<AttendanceRecordItem | null>(null);

  // 5. Data Query & Mutation
  const {
    data: attendanceData,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useAttendanceRecords(filters);

  const correctionStatusOptions = useMemo(() => [
    AttendanceStatus.PRESENT,
    AttendanceStatus.LATE,
    AttendanceStatus.HALF_DAY,
    AttendanceStatus.CHECKED_OUT,
    AttendanceStatus.ABSENT,
    AttendanceStatus.INCOMPLETE,
  ], []);

  const toDatetimeLocal = (value?: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const openCorrection = (record: AttendanceRecordItem, event?: React.MouseEvent) => {
    event?.stopPropagation();
    setCorrectingRecord(record);
    setNewStatus(record.status);
    setNewCheckInTime(toDatetimeLocal(record.checkInTime));
    setNewCheckOutTime(toDatetimeLocal(record.checkOutTime));
    setCorrectionReason("");
    setCorrectionError(null);
    setShowCorrectionConfirm(false);
  };

  const requestCorrectionConfirmation = () => {
    setCorrectionError(null);
    if (!correctionReason.trim() || correctionReason.trim().length < 5) {
      setCorrectionError("A correction reason of at least 5 characters is required.");
      return;
    }
    const checkIn = newCheckInTime ? new Date(newCheckInTime) : null;
    const checkOut = newCheckOutTime ? new Date(newCheckOutTime) : null;
    if ((checkIn && !Number.isFinite(checkIn.getTime())) || (checkOut && !Number.isFinite(checkOut.getTime()))) {
      setCorrectionError("Enter valid check-in and check-out times.");
      return;
    }
    if (checkOut && (!checkIn || checkOut.getTime() <= checkIn.getTime())) {
      setCorrectionError("Check-out must be after check-in.");
      return;
    }
    setShowCorrectionConfirm(true);
  };

  const applyCorrection = async () => {
    if (!correctingRecord || !canCorrect || correctMutation.isPending) return;
    try {
      await correctMutation.mutateAsync({
        id: correctingRecord._id,
        payload: {
          checkInTime: newCheckInTime ? new Date(newCheckInTime).toISOString() : null,
          checkOutTime: newCheckOutTime ? new Date(newCheckOutTime).toISOString() : null,
          status: newStatus,
          reason: correctionReason.trim(),
        },
      });
      success("Correction Applied", `Attendance for ${correctingRecord.employeeId} on ${correctingRecord.dateKey} was corrected and audited.`);
      setShowCorrectionConfirm(false);
      setCorrectingRecord(null);
      if (detailRecord?._id === correctingRecord._id) setDetailRecord(null);
    } catch (error) {
      setShowCorrectionConfirm(false);
      setCorrectionError(error instanceof Error ? error.message : "Failed to apply attendance correction.");
    }
  };

  // 6. Real-Time Socket Listener for live row updates
  useEffect(() => {
    if (!socket) return;

    const handleAttendanceUpdated = (payload: {
      recordId: string;
      employeeId: string;
      dateKey: string;
      status: string;
      punchType: string;
    }) => {
      refetch();
      setRecentlyUpdatedRowId(payload.recordId);
      setTimeout(() => setRecentlyUpdatedRowId(null), 3000);

      info(
        "Live Attendance Update",
        `Employee ${payload.employeeId} punched: ${payload.status} (${payload.punchType})`
      );
    };

    socket.on("attendance.updated", handleAttendanceUpdated);
    return () => {
      socket.off("attendance.updated", handleAttendanceUpdated);
    };
  }, [socket, refetch, info]);

  // Sorting
  const handleSort = (field: "dateKey" | "createdAt" | "employeeId" | "status") => {
    setFilters((prev) => {
      const isSame = prev.sortBy === field;
      const nextOrder = isSame && prev.sortOrder === "asc" ? "desc" : "asc";
      return { ...prev, sortBy: field, sortOrder: nextOrder, page: 1 };
    });
  };

  // Search Submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({ ...prev, search: searchInput.trim(), page: 1 }));
  };

  // Reset Filters
  const handleResetFilters = () => {
    setSearchInput("");
    setFilters({
      page: 1,
      limit: 10,
      search: "",
      department: "",
      status: undefined,
      workType: "",
      dateKey: "",
      sortBy: "dateKey",
      sortOrder: "desc",
    });
  };

  const pagination = attendanceData?.pagination;
  const records = attendanceData?.data || [];
  const isFiltered = Boolean(
    filters.search || filters.department || filters.status || filters.workType || filters.dateKey
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
              Attendance Ledger
            </h1>
            {pagination && (
              <Badge variant="info" size="md">
                {pagination.total} Records Found
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Organization-wide punch records, punctuality tracking, duration math, and administrative corrections
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5"
            title="Refresh attendance records"
          >
            <RotateCw className={`w-4 h-4 ${isFetching ? "animate-spin text-blue-600" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card className="p-4 space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} className="relative sm:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by employee name or ID..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-20 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:bg-white dark:focus-visible:bg-slate-900"
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 text-xs px-2.5"
            >
              Search
            </Button>
          </form>

          {/* Date Selector */}
          <div>
            <input
              type="date"
              value={filters.dateKey || ""}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, dateKey: e.target.value, page: 1 }))
              }
              className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              title="Filter by specific date"
            />
          </div>

          {/* Department Filter */}
          <div>
            <select
              value={filters.department || ""}
              disabled={departmentsLoading || departmentsError}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, department: e.target.value, page: 1 }))
              }
              aria-label="Filter by department"
              className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="">All Departments</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
            {departmentsError ? (
              <div className="mt-1 flex items-center gap-2 text-xs text-rose-600">
                <span>Departments could not be loaded.</span>
                <button type="button" className="underline" onClick={() => void refetchDepartments()}>Retry</button>
              </div>
            ) : null}
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={filters.status || ""}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  status: e.target.value ? (e.target.value as AttendanceStatus) : undefined,
                  page: 1,
                }))
              }
              aria-label="Filter by attendance status"
              className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="">All Statuses</option>
              <option value={AttendanceStatus.PRESENT}>PRESENT</option>
              <option value={AttendanceStatus.LATE}>LATE</option>
              <option value={AttendanceStatus.CHECKED_OUT}>CHECKED_OUT</option>
              <option value={AttendanceStatus.WFH_APPROVED}>WFH_APPROVED</option>
              <option value={AttendanceStatus.ON_LEAVE}>ON_LEAVE</option>
              <option value={AttendanceStatus.HALF_DAY}>HALF_DAY</option>
              <option value={AttendanceStatus.ABSENT}>ABSENT</option>
              <option value={AttendanceStatus.INCOMPLETE}>INCOMPLETE</option>
            </select>
          </div>
        </div>

        {/* Date Quick Shortcuts & Clear Row */}
        <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs gap-2">
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span>Quick Dates:</span>
            <button
              type="button"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  dateKey: new Date().toISOString().slice(0, 10),
                  page: 1,
                }))
              }
              className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  dateKey: "",
                  page: 1,
                }))
              }
              className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            >
              All Dates
            </button>
          </div>

          {isFiltered && (
            <button
              onClick={handleResetFilters}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 font-semibold"
            >
              Reset all filters
            </button>
          )}
        </div>
      </Card>

      {isError && attendanceData && (
        <ErrorState title="Attendance refresh failed"
          message={error instanceof Error ? error.message : "Showing the last successfully loaded records."}
          onRetry={() => void refetch()} isRetrying={isFetching} className="p-4" />
      )}

      {/* Ledger Table Card */}
      <Card className="border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider select-none z-10">
                <th
                  onClick={() => handleSort("dateKey")}
                  className="px-6 py-3 cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Date</span>
                    {filters.sortBy === "dateKey" ? (
                      filters.sortOrder === "asc" ? (
                        <ArrowUp className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("employeeId")}
                  className="px-4 py-3 cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Employee</span>
                    {filters.sortBy === "employeeId" ? (
                      filters.sortOrder === "asc" ? (
                        <ArrowUp className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </div>
                </th>
                <th className="px-4 py-3">Check-In</th>
                <th className="px-4 py-3">Check-Out</th>
                <th className="px-4 py-3">Duration</th>
                <th
                  onClick={() => handleSort("status")}
                  className="px-4 py-3 cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Status</span>
                    {filters.sortBy === "status" ? (
                      filters.sortOrder === "asc" ? (
                        <ArrowUp className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </div>
                </th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="px-4 py-4">
                      <Skeleton className="h-4 w-32 mb-1" />
                      <Skeleton className="h-3 w-20" />
                    </td>
                    <td className="px-4 py-4">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="px-4 py-4">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="px-4 py-4">
                      <Skeleton className="h-4 w-14" />
                    </td>
                    <td className="px-4 py-4">
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Skeleton className="h-8 w-24 ml-auto rounded-lg" />
                    </td>
                  </tr>
                ))
              ) : isError && !attendanceData ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8">
                    <ErrorState title="Unable to load attendance records"
                      message={error instanceof Error ? error.message : "The attendance request failed."}
                      onRetry={() => void refetch()} isRetrying={isFetching} />
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <EmptyState
                      title="No attendance records found"
                      description={
                        isFiltered
                          ? "Try clearing your filters or selecting another date range."
                          : "No attendance punches recorded yet."
                      }
                      action={
                        isFiltered ? (
                          <Button variant="outline" size="sm" onClick={handleResetFilters}>
                            Clear Filters
                          </Button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                records.map((rec) => {
                  const empName =
                    typeof rec.employee === "object" && rec.employee?.name
                      ? rec.employee.name
                      : rec.employeeId;
                  const empDept =
                    typeof rec.employee === "object" && rec.employee?.department
                      ? rec.employee.department
                      : rec.department;

                  const checkInDisplay = rec.checkInTime
                    ? new Date(rec.checkInTime).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "--:--";

                  const checkOutDisplay = rec.checkOutTime
                    ? new Date(rec.checkOutTime).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : rec.checkInTime
                    ? "In Progress"
                    : "--:--";

                  const durationDisplay =
                    rec.durationMinutes > 0
                      ? `${Math.floor(rec.durationMinutes / 60)}h ${rec.durationMinutes % 60}m`
                      : "-";

                  const isLiveHighlight = recentlyUpdatedRowId === rec._id;
                  const isDetailActive = detailRecord?._id === rec._id;

                  return (
                    <tr
                      key={rec._id}
                      onClick={() => setDetailRecord(rec)}
                      className={`cursor-pointer transition-colors ${
                        isDetailActive
                          ? "bg-blue-50/90 dark:bg-blue-950/50 ring-1 ring-blue-500/30"
                          : isLiveHighlight
                          ? "bg-blue-50/80 dark:bg-blue-950/40 animate-pulse"
                          : "hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                      }`}
                    >
                      {/* Date */}
                      <td className="px-6 py-3.5 font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {rec.dateKey}
                      </td>

                      {/* Employee Info */}
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{empName}</div>
                        <div className="text-[11px] text-slate-400 dark:text-slate-400 flex items-center gap-1">
                          <span className="font-mono text-slate-600 dark:text-slate-300 font-medium">
                            {rec.employeeId}
                          </span>
                          <span>&bull;</span>
                          <span>{empDept}</span>
                        </div>
                      </td>

                      {/* Check-In */}
                      <td className="px-4 py-3.5">
                        <div className="font-mono text-slate-700 dark:text-slate-200">{checkInDisplay}</div>
                        {rec.isLate && (
                          <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                            Late ({rec.lateMinutes}m)
                          </span>
                        )}
                      </td>

                      {/* Check-Out */}
                      <td className="px-4 py-3.5">
                        <div className="font-mono text-slate-700 dark:text-slate-200">{checkOutDisplay}</div>
                      </td>

                      {/* Duration */}
                      <td className="px-4 py-3.5 font-mono text-slate-700 dark:text-slate-200">
                        {durationDisplay}
                      </td>

                      {/* Status Badge & Correction indicator */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge
                            variant={
                              rec.status === AttendanceStatus.PRESENT
                                ? "success"
                                : rec.status === AttendanceStatus.LATE
                                ? "warning"
                                : rec.status === AttendanceStatus.WFH_APPROVED
                                ? "info"
                                : rec.status === AttendanceStatus.ON_LEAVE
                                ? "incomplete"
                                : rec.status === AttendanceStatus.CHECKED_OUT
                                ? "primary"
                                : rec.status === AttendanceStatus.ABSENT
                                ? "danger"
                                : "neutral"
                            }
                            size="sm"
                          >
                            {rec.status}
                          </Badge>
                          {rec.isEarlyCheckout && <Badge variant="warning" size="sm">Early Checkout</Badge>}

                          {rec.isManuallyCorrected && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 cursor-pointer"
                              title={`Corrected: ${rec.correctionReason || "Administrative override"}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setHistoryRecord(rec);
                              }}
                            >
                              Edited
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">

                          {canCorrect && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => openCorrection(rec, e)}
                              className="p-1.5 h-8 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                              title="Correct Attendance Record"
                            >
                              <Edit3 className="w-4 h-4 mr-1" />
                              <span>Correct</span>
                            </Button>
                          )}

                          {rec.corrections && rec.corrections.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHistoryRecord(rec);
                              }}
                              className="p-1.5 h-8 text-slate-500 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                              title="View Correction History"
                            >
                              <History className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {pagination && pagination.totalPages > 0 && (
          <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400 select-none">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={filters.limit || 10}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    limit: parseInt(e.target.value, 10),
                    page: 1,
                  }))
                }
                aria-label="Rows per page"
                className="px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <span className="text-slate-400 ml-2">
                Showing {Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total)} to{" "}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}{" "}
                records
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) - 1 }))}
                className="h-8 px-2.5"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline ml-1">Previous</span>
              </Button>
              <span className="px-3 py-1 font-semibold text-slate-800 dark:text-slate-200">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))}
                className="h-8 px-2.5"
              >
                <span className="hidden sm:inline mr-1">Next</span>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ======================================================== */}
      {/* Drawer: Detailed Punch Inspection Slide-Over             */}
      {/* ======================================================== */}
      <Drawer
        isOpen={Boolean(detailRecord)}
        onClose={() => setDetailRecord(null)}
        title="Attendance Punch Details"
        description={`Record for ${detailRecord?.employeeId} on ${detailRecord?.dateKey}`}
        width="lg"
        footer={
          <div className="flex items-center justify-between w-full">
            <Button
              variant="outline"
              size="md"
              onClick={() => setDetailRecord(null)}
            >
              Close
            </Button>
          </div>
        }
      >
        {detailRecord && (
          <div className="space-y-6">
            {/* Summary Identity Card */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                    {typeof detailRecord.employee === "object" && detailRecord.employee?.name
                      ? detailRecord.employee.name
                      : detailRecord.employeeId}
                  </h3>
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5">
                    <span className="font-mono font-medium">{detailRecord.employeeId}</span>
                    <span>&bull;</span>
                    <span>
                      {typeof detailRecord.employee === "object" && detailRecord.employee?.department
                        ? detailRecord.employee.department
                        : detailRecord.department}
                    </span>
                  </div>
                </div>

                <Badge
                  variant={
                    detailRecord.status === AttendanceStatus.PRESENT
                      ? "success"
                      : detailRecord.status === AttendanceStatus.LATE
                      ? "warning"
                      : detailRecord.status === AttendanceStatus.WFH_APPROVED
                      ? "info"
                      : detailRecord.status === AttendanceStatus.CHECKED_OUT
                      ? "primary"
                      : "neutral"
                  }
                  size="md"
                >
                  {detailRecord.status}
                </Badge>
              </div>
            </div>

            {/* Time Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-white dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <span className="text-slate-400 dark:text-slate-500 block mb-0.5">Check-In Timestamp</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  {detailRecord.checkInTime ? new Date(detailRecord.checkInTime).toLocaleString() : "Not Punched"}
                </span>
              </div>

              <div className="p-3 bg-white dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <span className="text-slate-400 dark:text-slate-500 block mb-0.5">Check-Out Timestamp</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  {detailRecord.checkOutTime ? new Date(detailRecord.checkOutTime).toLocaleString() : "In Progress"}
                </span>
              </div>

              <div className="p-3 bg-white dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <span className="text-slate-400 dark:text-slate-500 block mb-0.5">Calculated Duration</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  {detailRecord.durationMinutes > 0
                    ? `${Math.floor(detailRecord.durationMinutes / 60)}h ${detailRecord.durationMinutes % 60}m (${detailRecord.durationMinutes} mins)`
                    : "0m"}
                </span>
              </div>

              <div className="p-3 bg-white dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <span className="text-slate-400 dark:text-slate-500 block mb-0.5">Punctuality Deviation</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  {detailRecord.isLate ? (
                    <span className="text-amber-600 dark:text-amber-400 font-mono">
                      Late (+{detailRecord.lateMinutes} mins)
                    </span>
                  ) : (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      On Schedule
                    </span>
                  )}
                </span>
              </div>
            </div>

            {detailRecord.isEarlyCheckout && (
              <div className="rounded-xl border border-amber-300/40 bg-amber-50/70 dark:bg-amber-950/30 p-4 space-y-2 text-sm">
                <div className="font-semibold text-amber-800 dark:text-amber-300">Early Checkout</div>
                {detailRecord.shiftName && <div>Assigned shift: {detailRecord.shiftName}</div>}
                {detailRecord.scheduledShiftEndTime && <div>Scheduled shift end: {new Date(detailRecord.scheduledShiftEndTime).toLocaleString()}</div>}
                {detailRecord.checkOutTime && <div>Actual checkout: {new Date(detailRecord.checkOutTime).toLocaleString()}</div>}
                <div>Reason: {detailRecord.earlyCheckoutReason || "No reason recorded"}</div>
              </div>
            )}

            {/* Audit Correction Banner */}
            {detailRecord.isManuallyCorrected && (
              <div className="p-3.5 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900 rounded-xl space-y-1 text-xs">
                <div className="flex items-center gap-1.5 text-purple-800 dark:text-purple-300 font-semibold">
                  <Info className="w-4 h-4" />
                  <span>Administrative Override Audited</span>
                </div>
                <p className="text-purple-900 dark:text-purple-200">
                  Reason: &ldquo;{detailRecord.correctionReason}&rdquo;
                </p>
                {detailRecord.correctedAt && (
                  <span className="text-[10px] text-purple-500 dark:text-purple-400 font-mono block">
                    Updated {new Date(detailRecord.correctedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        isOpen={Boolean(correctingRecord) && canCorrect}
        onClose={() => { if (!correctMutation.isPending) setCorrectingRecord(null); }}
        title="Correct Attendance"
        description={`Record for ${correctingRecord?.employeeId} on ${correctingRecord?.dateKey}`}
        maxWidth="xl"
      >
        {correctingRecord && (
          <div className="space-y-5">
            {correctionError && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{correctionError}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Check-in time" type="datetime-local" value={newCheckInTime} onChange={(e) => setNewCheckInTime(e.target.value)} />
              <Input label="Check-out time" type="datetime-local" value={newCheckOutTime} onChange={(e) => setNewCheckOutTime(e.target.value)} />
            </div>
            <Select label="Attendance status" value={newStatus} onChange={(e) => setNewStatus(e.target.value as AttendanceStatus)}>
              {correctionStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </Select>
            <div>
              <label htmlFor="attendance-correction-reason" className="mb-1.5 block text-sm font-medium">Correction reason (required)</label>
              <textarea id="attendance-correction-reason" maxLength={500} rows={3} value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800" placeholder="Explain why this attendance record needs correction" />
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" size="sm" onClick={() => setCorrectingRecord(null)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={requestCorrectionConfirmation}>Review correction</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={showCorrectionConfirm && canCorrect}
        onClose={() => setShowCorrectionConfirm(false)}
        onConfirm={() => void applyCorrection()}
        title="Apply attendance correction?"
        message={`Confirm the corrected check-in, check-out, and status for ${correctingRecord?.employeeId} on ${correctingRecord?.dateKey}. This action will be recorded in the audit history.`}
        confirmText="Apply correction"
        cancelText="Review again"
        variant="primary"
        isLoading={correctMutation.isPending}
      />

      {/* ======================================================== */}
      {/* Modal: Correction History Audit Log                      */}
      {/* ======================================================== */}
      <Modal
        isOpen={Boolean(historyRecord)}
        onClose={() => setHistoryRecord(null)}
        title="Correction Audit History"
        description={`Audit trail for record ${historyRecord?.employeeId} (${historyRecord?.dateKey})`}
        maxWidth="lg"
      >
        {historyRecord && (
          <div className="space-y-4">
            {historyRecord.corrections && historyRecord.corrections.length > 0 ? (
              <div className="space-y-3">
                {historyRecord.corrections.map((entry, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Correction #{idx + 1}
                      </span>
                      <span className="font-mono text-[11px]">
                        {new Date(entry.correctedAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium">
                      &ldquo;{entry.correctionReason}&rdquo;
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400 pt-1">
                      <div>
                        <span className="text-slate-400 dark:text-slate-500 block">Previous:</span>
                        <span>
                          Status: {String(entry.previousValues?.status || "—")} • Duration:{" "}
                          {String(entry.previousValues?.durationMinutes ?? "—")}m
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 dark:text-slate-500 block">New Values:</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          Status: {String(entry.newValues?.status || "—")} • Duration:{" "}
                          {String(entry.newValues?.durationMinutes ?? "—")}m
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-400">
                No previous corrections recorded for this date.
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHistoryRecord(null)}
              >
                Close History
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
