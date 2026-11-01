# Enquiry Tab Count Bug Investigation & Resolution Plan

## Step 1: Baseline Before Any Edits

All baseline verification steps were performed on a dedicated Git branch `fix/enquiry-counts` branched from clean `main` (commit `6842b3f`).

### 1.1 Typecheck Baseline
All projects typechecked with **0 errors**:
- `packages/shared`: `tsc --noEmit` — **0 errors** (Pass)
- `apps/api`: `tsc --noEmit` — **0 errors** (Pass)
- `apps/web`: `tsc --noEmit` — **0 errors** (Pass)
- `apps/display`: `tsc --noEmit` — **0 errors** (Pass)
- `apps/mobile`: `tsc --noEmit` — **0 errors** (Pass)

### 1.2 Monorepo Production Build Baseline
Command: `npm run build`
- `@vorldx/shared`: `tsc` clean (exit code 0)
- `@vorldx/api`: `tsc` clean (exit code 0)
- `@vorldx/web`: `vite build` clean, 2417 modules transformed (exit code 0)
- `@vorldx/display`: `next build` clean (exit code 0)
- Total monorepo build status: **Pass (0 errors)**

### 1.3 Existing Enquiries Test Suite Baseline
Command: `vitest run tests/enquiries.test.ts`
- Test files: 1 passed (1)
- Tests: 16 passed (16)
- Duration: 5.60s
- Status: **Pass (100% passing)**

### 1.4 Characterization Suite Baseline
Characterization test suite: `scripts/characterize-enquiries-baseline.ts`
Verified all 12 key operations of the Enquiry subsystem:
- Check 1: Employee creates Enquiry 1 (Status: OPEN) — Pass
- Check 2: Employee creates Enquiry 2 — Pass
- Check 3: Second employee creates Enquiry 3 — Pass
- Check 4A: Employee permission scoping (sees own 2 tickets only) — Pass
- Check 4B: HR permission scoping (sees all 3 tickets) — Pass
- Check 5: Search filtering ('Lobby' returns exact matching ticket) — Pass
- Check 6: Status filtering ('OPEN' returns all 3 tickets) — Pass
- Check 7: Pagination (`page=1&limit=2` returns 2 of 3) — Pass
- Check 8: Open ticket & view conversation thread — Pass
- Check 9: HR sends reply into conversation thread — Pass
- Check 10: Assign ticket to HR staff member — Pass
- Check 11: Status updates to RESOLVED and CLOSED — Pass
- Check 12: Reopen ticket by employee within 7-day window — Pass
- Total characterization status: **12/12 Passed**

## Step 2: Root Cause Analysis

### 2.1 Problem Description
When navigating the Enquiries module in the web dashboard, the badge counts displayed on tabs and summary stat cards ("Open & Active", "All Tickets", "Assigned to Me", "Unassigned", "High & Urgent", "Resolved / Closed") did not update correctly when switching between them:
1. When switching to the "Resolved / Closed" tab, "Active & Open" dropped to `0`.
2. When switching to the "Open & Active" tab, "Resolved / Closed" dropped to `0`.
3. Total enquiries in the stat card dropped to only the total matching the current tab's filter.
4. Quick tabs lacked dedicated server-backed count badges, and cross-tab counts were vulnerable to client-side page slicing.

### 2.2 Root Cause
In `apps/web/src/pages/EnquiriesPage.tsx`:
- Stat cards and counts were computed client-side using `enquiries.filter(...)`, where `enquiries` is `enquiriesData?.data` (only the currently filtered page of at most 30 items for the active view).
- `totalCount` was bound to `enquiriesData?.total`, which represents the total matching the *active tab's filter criteria*, rather than the tenant/user dataset.
- There was no dedicated, authoritative read-only counts endpoint to serve as the single source of truth for tab and filter badges.
- When clicking the **"Unassigned"** tab, the frontend sent `assigneeId=UNASSIGNED`. In `apps/api/src/services/enquiry.service.ts`, the backend called `new Types.ObjectId(query.assigneeId)`. Because `"UNASSIGNED"` is not a valid 24-character hexadecimal ObjectId, Mongoose threw `BSONError: input must be a 24 character hex string...`, which resulted in an uncaught 500 error and triggered the UI error state: *"Failed to Load Enquiries: Could not retrieve enquiries from the backend service. Check your connection or feature flag configuration."*

---

## Step 3: Minimal Diff Implementation

### 3.1 Backend: Authoritative Scoped Counts Endpoint (`GET /api/enquiries/counts`)
- Added `getEnquiryCounts(userId, role)` in `apps/api/src/services/enquiry.service.ts`:
  - Uses a single high-performance MongoDB `$facet` aggregation to compute counts in one roundtrip.
  - Automatically scopes by user role: employees only receive counts of their own tickets (`{ employeeUser: userId }`); HR and admins receive tenant-wide counts.
  - Computes counts for:
    - `all`: total tickets
    - `active`: status in `["OPEN", "IN_PROGRESS"]`
    - `open`: status `"OPEN"`
    - `inProgress`: status `"IN_PROGRESS"`
    - `resolved`: status in `["RESOLVED", "CLOSED"]`
    - `resolvedOnly`: status `"RESOLVED"`
    - `closed`: status `"CLOSED"`
    - `myTickets`: tickets assigned to the calling user (`assignee == userId`)
    - `unassigned`: tickets without an assignee (`assignee == null`)
    - `highPriority`: priority in `["HIGH", "URGENT"]`
    - `byCategory`: breakdown by category (`ATTENDANCE`, `LEAVE`, `WFH`, `PAYROLL`, `TECHNICAL`, `OTHER`)
    - `byStatus`: breakdown by status
    - `byPriority`: breakdown by priority
- Added `getCounts` controller handler in `apps/api/src/controllers/enquiry.controller.ts`.
- Mounted `router.get("/counts", enquiryController.getCounts)` in `apps/api/src/routes/enquiry.routes.ts` before `/:id`.

### 3.2 Frontend: React Query Hook & Tab Badge Integration
- Added `useEnquiryCounts()` in `apps/web/src/api/queries.ts` (`staleTime: 15s`).
- Bound stat cards in `apps/web/src/pages/EnquiriesPage.tsx` to `counts`:
  - Total Enquiries -> `counts.total`
  - Active & Open -> `counts.active`
  - Assigned to Me -> `counts.myTickets`
  - Resolved / Closed -> `counts.resolved`
- Added count badges to Saved Views & Quick Tabs:
  - "Open & Active" `({counts.active})`
  - "All Tickets" `({counts.all})`
  - "Assigned to Me" `({counts.myTickets})`
  - "Unassigned" `({counts.unassigned})`
  - "High & Urgent" `({counts.highPriority})`
  - "Resolved / Closed" `({counts.resolved})`
- Added option counts to Category, Status, and Priority dropdown filters.
- Real-Time & Mutation Cache Invalidation:
  - Invalidates `["enquiry-counts"]` in `useCreateEnquiry`, `useSendEnquiryMessage`, `useUpdateEnquiryStatus`, `useAssignEnquiry`, `useReopenEnquiry`.
  - In `apps/web/src/context/SocketContext.tsx`, invalidates `["enquiry-counts"]` on `enquiry.created`, `enquiry.message_received`, `enquiry.status_updated`, `enquiry.assigned`.

---

## Step 4: Verification & Test Results

### 4.1 Vitest Backend Test Suite
Command: `vitest run tests/enquiries.test.ts`
- Total tests: **18 passed (18)**
- Added tests:
  - `returns accurate counts scoped for HR/Admin across all tickets` (Pass)
  - `scopes counts to only the caller's own tickets when requested by an employee` (Pass)

### 4.2 Tab Switching Verification Script (`scripts/verify-enquiry-counts-fix.ts`)
- Seeded diverse tickets across categories, priorities, statuses, and assignees.
- Verified initial counts match expected totals.
- Switched to "Resolved / Closed" tab: list filtered to resolved tickets only, while all tab counts and stat card badges remained 100% constant and accurate.
- Switched to "Assigned to Me" tab: list filtered to assigned tickets, while tab counts remained 100% constant and accurate.
- Performed live assignment mutation: verified `myTickets` updated immediately (2 -> 3) and `unassigned` updated (3 -> 2).
- Status: **Pass (4/4 test phases passed)**

### 4.3 Monorepo Typecheck & Production Build
- Monorepo Typecheck: **0 errors** across all 5 packages (`shared`, `api`, `web`, `display`, `mobile`).
- Monorepo Build: **All packages built cleanly (0 errors)**.


