# VorldX System Audit Fix Log

> **Log Date:** 2026-10-31  
> **Source Reference:** [docs/FUNCTIONALITY_AUDIT.md](file:///c:/Attendance%20Tracker/docs/FUNCTIONALITY_AUDIT.md)  
> **Objective:** Systematically document root cause analysis, targeted remedies, verified behaviors, and code modifications for issues identified during interactive audit and UI quality passes.

---

## Fix Summary & Status Ledger

| Issue ID | Priority | Category | Problem Summary | Status |
| :--- | :---: | :--- | :--- | :---: |
| **FIX-01** | Medium | Routing & Server | Direct browser address bar navigations to SPA routes returned `401 Unauthorized` JSON | 🟢 Resolved & Verified |
| **FIX-02** | Low | Accessibility | Modals did not restore focus to invoking trigger button on dismissal via ESC or backdrop | 🟢 Resolved & Verified |
| **FIX-03** | Low | Accessibility | Slide-over drawers did not restore focus to triggering table rows or buttons upon close | 🟢 Resolved & Verified |
| **FIX-04** | Low | Performance / Diagnostics | Benign Recharts ResizeObserver loop notifications in synthetic test runner logs | 🟢 Resolved & Verified |
| **FIX-05** | Enhancement | Design & Branding | Integration of official high-resolution VorldX logo across Display QR Kiosk and Web Portal | 🟢 Resolved & Verified |

---

## Detailed Issue Records

### FIX-01: Direct Single-Page Route Navigation via Express Backend
- **Priority**: Medium
- **Component**: `apps/api`
- **Issue**: Navigating directly in a browser to `/attendance`, `/wfh`, `/calendar`, `/leave`, or other client-side routes returned `401 Unauthorized` JSON (`{"error":"Unauthorized"}`) instead of delivering the React SPA `index.html` shell.
- **Root Cause**: In `apps/api/src/app.ts`, `app.use(routes)` was mounted before the static SPA fallback middleware (`express.static(webDistPath)` and `app.get("*")`). When a browser directly opens `/attendance`, the request is sent with `Accept: text/html` but lacks an `Authorization: Bearer <token>` header. Express matched the route against `attendanceRouter` mounted at `/attendance`, which invoked `authenticate` middleware and rejected the call before the SPA handler could respond.
- **Fix**: Added an HTML navigation interceptor before `app.use(routes)` in `apps/api/src/app.ts`. When `req.method === "GET"` and `req.headers.accept?.includes("text/html")` for non-API (`!req.path.startsWith("/api")`, `!req.path.startsWith("/health")`, `!req.path.startsWith("/socket.io")`) requests, Express immediately serves `webDistPath/index.html`. API endpoints and client AJAX requests (`Accept: application/json`) pass through untouched to the API routers.
- **Files Changed**:
  - [`apps/api/src/app.ts`](file:///c:/Attendance%20Tracker/apps/api/src/app.ts)

---

### FIX-02: Modal Keyboard Focus Restoration on Escape / Backdrop Dismissal
- **Priority**: Low
- **Component**: `apps/web` (`Modal.tsx`)
- **Issue**: Dismissing an open dialog modal using the Escape key or backdrop click left keyboard focus detached on `document.body`, requiring keyboard-only users to restart tab traversal.
- **Root Cause**: `apps/web/src/components/ui/Modal.tsx` lacked state retention of `document.activeElement` prior to modal mount.
- **Fix**: Introduced `previousActiveElement = useRef<HTMLElement | null>(null)` to capture `document.activeElement` when `isOpen` becomes true, and dispatched `.focus()` to the cached element on component unmount / modal dismissal.
- **Files Changed**:
  - [`apps/web/src/components/ui/Modal.tsx`](file:///c:/Attendance%20Tracker/apps/web/src/components/ui/Modal.tsx)

---

### FIX-03: Drawer Keyboard Focus Restoration on Close
- **Priority**: Low
- **Component**: `apps/web` (`Drawer.tsx`)
- **Issue**: Closing an attendance record or audit diff slide-over drawer did not return focus to the clicked table row or action button.
- **Root Cause**: `apps/web/src/components/ui/Drawer.tsx` focused the drawer's close button on open, but did not restore focus to the originating element when the drawer was closed.
- **Fix**: Added `previousActiveElement` tracking in `Drawer.tsx` to automatically restore focus to the calling element upon drawer closure or Escape keypress.
- **Files Changed**:
  - [`apps/web/src/components/ui/Drawer.tsx`](file:///c:/Attendance%20Tracker/apps/web/src/components/ui/Drawer.tsx)

---

### FIX-04: Recharts ResizeObserver Notification Handling
- **Priority**: Low
- **Component**: `apps/web` (`main.tsx`)
- **Issue**: Harmless browser ResizeObserver notifications ("ResizeObserver loop completed with undelivered notifications") occasionally surfaced in synthetic browser test harnesses when resizing charts rapidly.
- **Root Cause**: Recharts `ResponsiveContainer` observes dimensions during window resizing; benign multi-pass notifications were captured as unhandled errors by standard test runners.
- **Fix**: Implemented a protective error filter in `apps/web/src/main.tsx` that catches and safely absorbs benign ResizeObserver notifications without suppressing real application exceptions.
- **Files Changed**:
  - [`apps/web/src/main.tsx`](file:///c:/Attendance%20Tracker/apps/web/src/main.tsx)

---

### FIX-05: Official VorldX Brand Asset & High-Resolution QR Logo Integration
- **Priority**: Enhancement
- **Component**: `apps/display`, `apps/web`
- **Issue**: The office kiosk QR code used a low-resolution placeholder JPEG, and the web portal displayed a generic icon rather than the official VorldX company branding.
- **Root Cause**: Official vector/high-resolution PNG assets were pending integration.
- **Fix**: Integrated the authentic VorldX emblem (Globe with twisting structural ribbon and typography):
  1. Updated `apps/display/lib/logo.ts` and `apps/display/public/vorldx-logo.png` with the crisp data URI for centered SVG QR code rendering with 15.8% optimal area and error correction level H.
  2. Placed `apps/web/public/vorldx-logo.png` and updated `apps/web/src/components/layout/Sidebar.tsx` and `apps/web/src/pages/LoginPage.tsx` brand headers with the official emblem.
- **Files Changed**:
  - [`apps/display/lib/logo.ts`](file:///c:/Attendance%20Tracker/apps/display/lib/logo.ts)
  - `apps/display/public/vorldx-logo.png`
  - `apps/web/public/vorldx-logo.png`
  - [`apps/web/src/components/layout/Sidebar.tsx`](file:///c:/Attendance%20Tracker/apps/web/src/components/layout/Sidebar.tsx)
  - [`apps/web/src/pages/LoginPage.tsx`](file:///c:/Attendance%20Tracker/apps/web/src/pages/LoginPage.tsx)

