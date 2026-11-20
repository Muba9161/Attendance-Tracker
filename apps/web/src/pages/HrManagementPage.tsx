import React, { useState } from "react";
import { Eye, EyeOff, Pencil, RefreshCw, ShieldCheck, Trash2, UserCog, UserMinus, UserPlus, UserRoundCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { useCreateHrAccount, useDeleteHrManagementRecord, useHrManagement, useResendHrInvitation, useUpdateHrManagementRecord, useUpdateHrStatus, HrManagementItem } from "../api/queries";
import { useToast } from "../components/ui/Toast";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The request could not be completed. Please try again.";

const invitationBadge = (status: HrManagementItem["invitationStatus"]) => {
  if (status === "Accepted") return <Badge variant="success">Accepted</Badge>;
  if (status === "Expired") return <Badge variant="danger">Expired</Badge>;
  return <Badge variant="warning">Pending</Badge>;
};

export const HrManagementPage: React.FC = () => {
  type PendingAction = { kind: "suspend" | "activate" | "delete" | "save"; record: HrManagementItem };
  const [inviteForm, setInviteForm] = useState({ name: "", email: "", department: "", designation: "", password: "", confirmPassword: "" });
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [createdHr, setCreatedHr] = useState<{ name: string; email: string; password: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [viewingRecord, setViewingRecord] = useState<HrManagementItem | null>(null);
  const [editingRecord, setEditingRecord] = useState<HrManagementItem | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", department: "", designation: "" });
  const { data, isLoading, isError, error, refetch } = useHrManagement();
  const createHrAccount = useCreateHrAccount();
  const resendInvite = useResendHrInvitation();
  const updateStatus = useUpdateHrStatus();
  const updateRecord = useUpdateHrManagementRecord();
  const deleteRecord = useDeleteHrManagementRecord();
  const { success, error: showError } = useToast();
  const records = data?.data || [];
  const normalizedInviteEmail = inviteForm.email.trim().toLowerCase();
  const duplicateAccount = normalizedInviteEmail
    ? records.find((record) => record.email.trim().toLowerCase() === normalizedInviteEmail && record.accountStatus !== "NOT_CREATED")
    : undefined;

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanInvite = {
      name: inviteForm.name.trim(),
      email: normalizedInviteEmail,
      department: inviteForm.department.trim(),
      designation: inviteForm.designation.trim(),
      password: inviteForm.password,
    };
    const errors: Record<string, string> = {};
    if (cleanInvite.name.length < 2) errors.name = "Enter the HR teammate's full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanInvite.email)) errors.email = "Enter a valid email address.";
    if (!cleanInvite.department) errors.department = "Enter a department.";
    if (!cleanInvite.designation) errors.designation = "Enter a designation.";
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*[\d\W]).{8,128}$/.test(cleanInvite.password)) {
      errors.password = "Use at least 8 characters with uppercase, lowercase, and a number or symbol.";
    }
    if (inviteForm.confirmPassword !== cleanInvite.password) errors.confirmPassword = "Passwords do not match.";
    if (duplicateAccount) errors.email = "This email already has an HR account.";
    setInviteErrors(errors);
    if (Object.keys(errors).length) return;
    try {
      await createHrAccount.mutateAsync(cleanInvite);
      setCreatedHr({ name: cleanInvite.name, email: cleanInvite.email, password: cleanInvite.password });
      setInviteForm({ name: "", email: "", department: "", designation: "", password: "", confirmPassword: "" });
      setInviteErrors({});
    } catch (err) {
      showError("HR account creation failed", errorMessage(err));
      void refetch();
    }
  };

  const copyCreatedPassword = async () => {
    if (!createdHr) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(createdHr.password);
      success("Password copied", "Share it with the HR teammate through a secure channel.");
    } catch {
      showError("Could not copy password", "Select and copy the password manually before closing this dialog.");
    }
  };

  const resend = async (record: HrManagementItem) => {
    try {
      await resendInvite.mutateAsync(record.id);
      success("Invitation resent", `A new invitation link was sent to ${record.email}.`);
    } catch (err) {
      showError("Could not resend invitation", errorMessage(err));
    }
  };

  const changeStatus = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    try {
      if (action.kind === "suspend" || action.kind === "activate") {
        const status = action.kind === "suspend" ? "INACTIVE" : "ACTIVE";
        await updateStatus.mutateAsync({ userId: action.record.id, status });
        success(status === "ACTIVE" ? "HR account reactivated" : "HR account suspended", action.record.email);
      } else if (action.kind === "delete") {
        await deleteRecord.mutateAsync(action.record.id);
        success("HR record deleted", `${action.record.email} was removed.`);
      } else {
        await updateRecord.mutateAsync({ recordId: action.record.id, details: editDraft });
        success("HR details updated", `Changes for ${action.record.email} were saved.`);
        setEditingRecord(null);
      }
    } catch (err) {
      showError("Could not complete action", errorMessage(err));
    } finally {
      setPendingAction(null);
    }
  };

  const startEdit = (record: HrManagementItem) => {
    setEditingRecord(record);
    setEditDraft({ name: record.name === record.email ? "" : record.name, department: record.department || "", designation: record.designation || "" });
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400">
            <UserCog className="w-5 h-5" />
            <span className="text-xs font-bold uppercase tracking-widest">People & access</span>
          </div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">HR Management</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Invite HR teammates and manage their account access.</p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-500" /> Admin controlled
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Create an HR account</CardTitle>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create a login directly when invitation email is unavailable. Set an initial password and share it securely with the HR teammate.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={invite} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Input type="text" label="Full name" placeholder="e.g. Priya Sharma" autoComplete="name" value={inviteForm.name} onChange={(event) => setInviteForm((form) => ({ ...form, name: event.target.value }))} error={inviteErrors.name} disabled={createHrAccount.isPending} maxLength={100} required />
            </div>
            <div>
              <Input
                type="email"
                label="HR email"
                placeholder="name@company.com"
                autoComplete="email"
                value={inviteForm.email}
                onChange={(event) => {
                  setInviteForm((form) => ({ ...form, email: event.target.value }));
                  setInviteErrors((current) => ({ ...current, email: "" }));
                }}
                error={inviteErrors.email || (duplicateAccount ? "This email already has an HR account." : "")}
                disabled={createHrAccount.isPending}
                required
              />
            </div>
            <div>
              <Input type="text" label="Department" placeholder="e.g. Human Resources" value={inviteForm.department} onChange={(event) => setInviteForm((form) => ({ ...form, department: event.target.value }))} error={inviteErrors.department} disabled={createHrAccount.isPending} maxLength={100} required />
            </div>
            <div>
              <Input type="text" label="Designation" placeholder="e.g. HR Manager" value={inviteForm.designation} onChange={(event) => setInviteForm((form) => ({ ...form, designation: event.target.value }))} error={inviteErrors.designation} disabled={createHrAccount.isPending} maxLength={100} required />
            </div>
            <div>
              <div className="relative">
                <Input type={showInitialPassword ? "text" : "password"} label="Initial password" placeholder="At least 8 characters" autoComplete="new-password" value={inviteForm.password} onChange={(event) => setInviteForm((form) => ({ ...form, password: event.target.value }))} error={inviteErrors.password} helperText="Use uppercase, lowercase, and a number or symbol. This is not emailed." disabled={createHrAccount.isPending} minLength={8} maxLength={128} required className="pr-10" />
                <button type="button" onClick={() => setShowInitialPassword((visible) => !visible)} className="absolute right-3 top-[2.35rem] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white" aria-label={showInitialPassword ? "Hide initial password" : "Show initial password"} aria-pressed={showInitialPassword}>
                  {showInitialPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <div className="relative">
                <Input type={showConfirmPassword ? "text" : "password"} label="Confirm password" placeholder="Re-enter the password" autoComplete="new-password" value={inviteForm.confirmPassword} onChange={(event) => setInviteForm((form) => ({ ...form, confirmPassword: event.target.value }))} error={inviteErrors.confirmPassword} disabled={createHrAccount.isPending} minLength={8} maxLength={128} required className="pr-10" />
                <button type="button" onClick={() => setShowConfirmPassword((visible) => !visible)} className="absolute right-3 top-[2.35rem] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white" aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} aria-pressed={showConfirmPassword}>
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="sm:col-span-2 sm:flex sm:justify-end">
            <Button type="submit" className="w-full sm:w-auto" isLoading={createHrAccount.isPending} disabled={!!duplicateAccount || !inviteForm.name.trim() || !inviteForm.email.trim() || !inviteForm.department.trim() || !inviteForm.designation.trim() || !inviteForm.password || !inviteForm.confirmPassword}>
              <UserPlus className="w-4 h-4" /> Create HR account
            </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>HR accounts and invitations</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{records.length} account{records.length === 1 ? "" : "s"} and invitation{records.length === 1 ? "" : "s"}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()} aria-label="Refresh HR list">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3" aria-label="Loading HR accounts">
              <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
              <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
              <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
            </div>
          ) : isError ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-rose-600 dark:text-rose-400">Could not load HR accounts.</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{errorMessage(error)}</p>
              <Button className="mt-4" variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
            </div>
          ) : records.length === 0 ? (
            <div className="p-10 text-center">
              <UserPlus className="mx-auto w-8 h-8 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">No HR accounts yet</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Send an invitation to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/50 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3 font-semibold">HR teammate</th>
                    <th className="px-5 py-3 font-semibold">Role</th>
                    <th className="px-5 py-3 font-semibold">Account status</th>
                    <th className="px-5 py-3 font-semibold">Invitation</th>
                    <th className="px-5 py-3 font-semibold">Created</th>
                    <th className="px-5 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {records.map((record) => (
                    <tr key={record.id} className="text-slate-700 dark:text-slate-200">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-900 dark:text-white">{record.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{record.email}</p>
                      </td>
                      <td className="px-5 py-4"><Badge variant="info">{record.role}</Badge></td>
                      <td className="px-5 py-4">
                        {record.accountStatus === "ACTIVE" ? <Badge variant="success">Active</Badge> :
                          record.accountStatus === "INACTIVE" ? <Badge variant="danger">Deactivated</Badge> :
                            <Badge variant="neutral">Not created</Badge>}
                      </td>
                      <td className="px-5 py-4">{invitationBadge(record.invitationStatus)}</td>
                      <td className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400">{new Date(record.createdAt).toLocaleDateString()}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => setViewingRecord(record)} aria-label={`View ${record.email}`}>
                            <Eye className="w-3.5 h-3.5" /> View
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => startEdit(record)} aria-label={`Edit ${record.email}`}>
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </Button>
                          {record.invitationStatus !== "Accepted" && (
                            <Button type="button" size="sm" variant="outline" onClick={() => void resend(record)} isLoading={resendInvite.isPending && resendInvite.variables === record.id}>
                              <RefreshCw className="w-3.5 h-3.5" /> Resend
                            </Button>
                          )}
                          {record.invitationStatus === "Accepted" && (
                            <Button type="button" size="sm" variant={record.accountStatus === "ACTIVE" ? "danger" : "secondary"} onClick={() => setPendingAction({ kind: record.accountStatus === "ACTIVE" ? "suspend" : "activate", record })}>
                              {record.accountStatus === "ACTIVE" ? <UserMinus className="w-3.5 h-3.5" /> : <UserRoundCheck className="w-3.5 h-3.5" />}
                              {record.accountStatus === "ACTIVE" ? "Suspend" : "Reactivate"}
                            </Button>
                          )}
                          <Button type="button" size="sm" variant="danger" onClick={() => setPendingAction({ kind: "delete", record })} aria-label={`Delete ${record.email}`}>
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {createdHr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="hr-created-title" className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 shadow-2xl dark:border-emerald-900 dark:bg-slate-900">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><UserRoundCheck className="h-6 w-6" /></div>
            <h2 id="hr-created-title" className="mt-4 text-lg font-bold text-slate-900 dark:text-white">HR account created</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300"><strong>{createdHr.name}</strong> can sign in with <strong>{createdHr.email}</strong>. No email was sent.</p>
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-xs font-semibold uppercase text-amber-800 dark:text-amber-300">Initial password — share securely</p>
              <code className="mt-1 block select-all break-all text-sm text-slate-900 dark:text-white">{createdHr.password}</code>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void copyCreatedPassword()}>Copy password</Button>
            </div>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">The password is shown only in this dialog. Copy or share it securely before closing.</p>
            <div className="mt-6 flex justify-end"><Button type="button" onClick={() => setCreatedHr(null)}>Done</Button></div>
          </section>
        </div>
      )}

      {viewingRecord && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingRecord(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="hr-view-title" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h2 id="hr-view-title" className="text-lg font-bold text-slate-900 dark:text-white">HR teammate details</h2>
            <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[["Name", viewingRecord.name], ["Email", viewingRecord.email], ["Department", viewingRecord.department || "Not set"], ["Designation", viewingRecord.designation || "Not set"], ["Account", viewingRecord.accountStatus], ["Invitation", viewingRecord.invitationStatus], ["Added", new Date(viewingRecord.createdAt).toLocaleString()]].map(([label, value]) => (
                <div key={label}><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-900 dark:text-slate-100">{value}</dd></div>
              ))}
            </dl>
            <div className="mt-6 flex justify-end"><Button type="button" variant="secondary" onClick={() => setViewingRecord(null)}>Close</Button></div>
          </section>
        </div>
      )}

      {editingRecord && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingRecord(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="hr-edit-title" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h2 id="hr-edit-title" className="text-lg font-bold text-slate-900 dark:text-white">Edit HR teammate</h2>
            <p className="mt-1 text-sm text-slate-500">{editingRecord.email}</p>
            <div className="mt-5 space-y-4">
              {([["Name", "name"], ["Department", "department"], ["Designation", "designation"]] as const).map(([label, key]) => (
                <label key={key} className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}
                  <input value={editDraft[key]} onChange={(event) => setEditDraft((draft) => ({ ...draft, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white" maxLength={100} required />
                </label>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditingRecord(null)}>Cancel</Button><Button type="button" disabled={!editDraft.name.trim() || !editDraft.department.trim() || !editDraft.designation.trim()} onClick={() => setPendingAction({ kind: "save", record: editingRecord })}>Save changes</Button></div>
          </section>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!pendingAction}
        onClose={() => setPendingAction(null)}
        onConfirm={() => void changeStatus()}
        title={pendingAction?.kind === "delete" ? "Delete this HR record?" : pendingAction?.kind === "save" ? "Save these HR changes?" : pendingAction?.kind === "suspend" ? "Suspend this HR account?" : "Reactivate this HR account?"}
        message={pendingAction?.kind === "delete"
          ? pendingAction.record.accountStatus === "NOT_CREATED"
            ? `The invitation for ${pendingAction.record.email} will be permanently removed.`
            : `The login account for ${pendingAction.record.email} will be deleted and its employee profile archived. Historical attendance records will be retained.`
          : pendingAction?.kind === "save"
            ? `Confirm saving the updated name, department, and designation for ${pendingAction.record.email}.`
            : pendingAction?.kind === "suspend"
              ? `${pendingAction.record.email} will be signed out and blocked from logging in until reactivated.`
              : `${pendingAction?.record.email} will be able to sign in again.`}
        confirmText={pendingAction?.kind === "delete" ? "Delete record" : pendingAction?.kind === "save" ? "Confirm save" : pendingAction?.kind === "suspend" ? "Suspend account" : "Reactivate account"}
        variant={pendingAction?.kind === "delete" || pendingAction?.kind === "suspend" ? "danger" : "primary"}
        isLoading={updateStatus.isPending || updateRecord.isPending || deleteRecord.isPending}
      />
    </div>
  );
};

