"use client";

import React, { useState, useEffect, useCallback } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

interface Stats {
  users: number;
  activeUsers: number;
  envelopes: number;
  sentEnvelopes: number;
  completedEnvelopes: number;
  pendingInvitations: number;
}

interface User {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  is_active: number;
  created_at: string;
  envelope_count: number;
}

interface Invitation {
  id: string;
  name: string;
  email: string;
  role: string;
  token: string;
  accepted: number;
  expires_at: string;
  created_at: string;
  invited_by_name: string;
}

interface Envelope {
  id: string;
  title: string;
  status: string;
  owner_name: string;
  owner_email: string;
  total_signers: number;
  signed_count: number;
  updated_at: string;
  created_at: string;
}

// ── API helper ──────────────────────────────────────────────────────────────

async function api<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

// ── Invite Modal ────────────────────────────────────────────────────────────

function InviteModal({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/api/admin/invite", {
        method: "POST",
        body: JSON.stringify({ name: email.split("@")[0], email, role }),
      });
      setEmail("");
      setRole("user");
      onInvited();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Invite User</h3>
          <button style={styles.modalClose} onClick={onClose}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={styles.inputLabel}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              required
              style={styles.input}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={styles.inputLabel}>Role</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              <label
                style={{
                  ...styles.radioCard,
                  ...(role === "user" ? styles.radioCardActive : {}),
                }}
                onClick={() => setRole("user")}
              >
                <div style={styles.radioRow}>
                  <div
                    style={{
                      ...styles.radioCircle,
                      ...(role === "user" ? styles.radioCircleActive : {}),
                    }}
                  >
                    {role === "user" && <div style={styles.radioDot} />}
                  </div>
                  <div>
                    <div style={styles.radioTitle}>User</div>
                    <div style={styles.radioDesc}>
                      Can create, send, and sign documents. Standard access level.
                    </div>
                  </div>
                </div>
              </label>

              <label
                style={{
                  ...styles.radioCard,
                  ...(role === "admin" ? styles.radioCardActive : {}),
                }}
                onClick={() => setRole("admin")}
              >
                <div style={styles.radioRow}>
                  <div
                    style={{
                      ...styles.radioCircle,
                      ...(role === "admin" ? styles.radioCircleActive : {}),
                    }}
                  >
                    {role === "admin" && <div style={styles.radioDot} />}
                  </div>
                  <div>
                    <div style={styles.radioTitle}>Admin</div>
                    <div style={styles.radioDesc}>
                      Full access including user management, invitations, and system settings.
                    </div>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {error && <div style={styles.errorMsg}>{error}</div>}

          <div style={styles.modalFooter}>
            <button type="button" onClick={onClose} style={styles.btnSecondary}>
              Cancel
            </button>
            <button type="submit" disabled={loading} style={styles.btnPrimary}>
              {loading ? "Sending..." : "Send Invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Admin Page ─────────────────────────────────────────────────────────

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [activeTab, setActiveTab] = useState<"users" | "invitations" | "envelopes">("users");
  const [inviteOpen, setInviteOpen] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api<Stats>("/api/admin/stats"));
    } catch {}
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await api<User[]>("/api/admin/users"));
    } catch {}
  }, []);

  const loadInvitations = useCallback(async () => {
    try {
      setInvitations(await api<Invitation[]>("/api/admin/invitations"));
    } catch {}
  }, []);

  const loadEnvelopes = useCallback(async () => {
    try {
      setEnvelopes(await api<Envelope[]>("/api/admin/envelopes"));
    } catch {}
  }, []);

  useEffect(() => {
    loadStats();
    loadUsers();
    loadInvitations();
    loadEnvelopes();
  }, [loadStats, loadUsers, loadInvitations, loadEnvelopes]);

  const toggleRole = async (id: number, currentRole: string) => {
    if (!confirm("Change this user's role?")) return;
    try {
      await api(`/api/admin/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: currentRole === "admin" ? "user" : "admin" }),
      });
      loadUsers();
    } catch {}
  };

  const toggleStatus = async (id: number, isActive: number) => {
    if (!confirm(isActive ? "Deactivate this user?" : "Activate this user?")) return;
    try {
      await api(`/api/admin/users/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !isActive }),
      });
      loadUsers();
    } catch {}
  };

  const revokeInvite = async (id: string) => {
    if (!confirm("Revoke this invitation?")) return;
    try {
      await api(`/api/admin/invitations/${id}`, { method: "DELETE" });
      loadInvitations();
      loadStats();
    } catch {}
  };

  const fmtDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const statusLabel = (s: string) => {
    if (!s) return "Draft";
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  return (
    <div style={styles.page}>
      {/* ── Page Header ── */}
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Admin Panel</h1>
        <button style={styles.btnPrimary} onClick={() => setInviteOpen(true)}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{ marginRight: 6 }}
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Invite User
        </button>
      </div>

      {/* ── Stat Cards ── */}
      <div style={styles.statsGrid}>
        <StatCard label="Total Users" value={stats?.users ?? 0} />
        <StatCard label="Active Users" value={stats?.activeUsers ?? 0} />
        <StatCard label="Envelopes" value={stats?.envelopes ?? 0} />
        <StatCard label="In Progress" value={stats?.sentEnvelopes ?? 0} />
        <StatCard label="Completed" value={stats?.completedEnvelopes ?? 0} />
        <StatCard label="Pending Invites" value={stats?.pendingInvitations ?? 0} />
      </div>

      {/* ── Tabs ── */}
      <div style={styles.tabs}>
        {(["users", "invitations", "envelopes"] as const).map((tab) => (
          <button
            key={tab}
            style={{
              ...styles.tab,
              ...(activeTab === tab ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "users" ? "Users" : tab === "invitations" ? "Invitations" : "All Envelopes"}
          </button>
        ))}
      </div>

      {/* ── Users Tab ── */}
      {activeTab === "users" && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Envelopes</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={styles.tr}>
                  <td style={styles.td}>
                    <strong>{u.name}</strong>
                  </td>
                  <td style={styles.td}>{u.email}</td>
                  <td style={styles.td}>
                    <span
                      style={{
                        ...styles.roleBadge,
                        ...(u.role === "admin" ? styles.roleAdmin : styles.roleUser),
                      }}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          ...styles.statusDot,
                          background: u.is_active ? "#059669" : "#9ca3af",
                        }}
                      />
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={styles.td}>{u.envelope_count}</td>
                  <td style={styles.td}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        style={styles.btnSmSecondary}
                        onClick={() => toggleRole(u.id, u.role)}
                      >
                        Make {u.role === "admin" ? "User" : "Admin"}
                      </button>
                      <button
                        style={styles.btnSmSecondary}
                        onClick={() => toggleStatus(u.id, u.is_active)}
                      >
                        {u.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Invitations Tab ── */}
      {activeTab === "invitations" && (
        <div style={styles.tableWrap}>
          {invitations.length === 0 ? (
            <div style={styles.emptyState}>No invitations yet.</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Email</th>
                  <th style={styles.th}>Role</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Invited By</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const expired = new Date(inv.expires_at) < new Date();
                  const st = inv.accepted ? "Accepted" : expired ? "Expired" : "Pending";
                  return (
                    <tr key={inv.id} style={styles.tr}>
                      <td style={styles.td}>{inv.name}</td>
                      <td style={styles.td}>{inv.email}</td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.roleBadge,
                            ...(inv.role === "admin" ? styles.roleAdmin : styles.roleUser),
                          }}
                        >
                          {inv.role || "user"}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.statusBadge,
                            ...(st === "Accepted"
                              ? styles.statusCompleted
                              : st === "Expired"
                                ? styles.statusExpired
                                : styles.statusPending),
                          }}
                        >
                          {st}
                        </span>
                      </td>
                      <td style={styles.td}>{inv.invited_by_name}</td>
                      <td style={styles.td}>
                        {!inv.accepted && !expired && (
                          <button
                            style={styles.btnSmDanger}
                            onClick={() => revokeInvite(inv.id)}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── All Envelopes Tab ── */}
      {activeTab === "envelopes" && (
        <div style={styles.tableWrap}>
          {envelopes.length === 0 ? (
            <div style={styles.emptyState}>No envelopes.</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Title</th>
                  <th style={styles.th}>Owner</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Signers</th>
                  <th style={styles.th}>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {envelopes.map((env) => (
                  <tr key={env.id} style={styles.tr}>
                    <td style={styles.td}>
                      <strong>{env.title || "Untitled"}</strong>
                    </td>
                    <td style={styles.td}>{env.owner_name}</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...(env.status === "completed"
                            ? styles.statusCompleted
                            : env.status === "sent"
                              ? styles.statusPending
                              : env.status === "voided"
                                ? styles.statusExpired
                                : styles.statusDraft),
                        }}
                      >
                        {statusLabel(env.status)}
                      </span>
                    </td>
                    <td style={styles.td}>
                      {env.signed_count || 0} / {env.total_signers || 0}
                    </td>
                    <td style={styles.td}>{fmtDate(env.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Invite Modal ── */}
      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={() => {
          loadInvitations();
          loadStats();
        }}
      />
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "32px 24px",
    fontFamily:
      "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#1a1a1a",
  },

  // Page header
  pageHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 600,
    margin: 0,
  },

  // Stats grid
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: 14,
    marginBottom: 28,
  },
  statCard: {
    background: "#fff",
    border: "1px solid #e5e5e3",
    borderRadius: 12,
    padding: "20px 18px",
  },
  statLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: "#78766d",
    marginBottom: 6,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    color: "#1a1a1a",
    lineHeight: 1,
  },

  // Tabs
  tabs: {
    display: "flex",
    gap: 0,
    borderBottom: "1px solid #e5e5e3",
    marginBottom: 20,
  },
  tab: {
    padding: "10px 18px",
    fontSize: 13,
    fontWeight: 500,
    color: "#78766d",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    cursor: "pointer",
    marginBottom: -1,
    transition: "all 0.12s",
  },
  tabActive: {
    color: "#2563a8",
    borderBottomColor: "#2563a8",
  },

  // Table
  tableWrap: {
    background: "#fff",
    border: "1px solid #e5e5e3",
    borderRadius: 12,
    overflow: "hidden",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  },
  th: {
    textAlign: "left" as const,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#78766d",
    padding: "10px 14px",
    background: "#f7f7f5",
    borderBottom: "1px solid #e5e5e3",
  },
  tr: {
    borderBottom: "1px solid #e5e5e3",
  },
  td: {
    padding: "12px 14px",
    fontSize: 13,
    verticalAlign: "middle" as const,
  },

  // Badges
  roleBadge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "capitalize" as const,
  },
  roleAdmin: {
    background: "#e8f0fe",
    color: "#2563a8",
  },
  roleUser: {
    background: "#f0f0ee",
    color: "#78766d",
  },

  statusDot: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: "50%",
  },

  statusBadge: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
  },
  statusCompleted: {
    background: "#d1fae5",
    color: "#059669",
  },
  statusPending: {
    background: "#fef3c7",
    color: "#d97706",
  },
  statusExpired: {
    background: "#fee2e2",
    color: "#dc2626",
  },
  statusDraft: {
    background: "#f0f0ee",
    color: "#78766d",
  },

  // Buttons
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    background: "#2563a8",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 500,
    color: "#1a1a1a",
    background: "#fff",
    border: "1px solid #e5e5e3",
    borderRadius: 8,
    cursor: "pointer",
  },
  btnSmSecondary: {
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 500,
    color: "#1a1a1a",
    background: "#fff",
    border: "1px solid #e5e5e3",
    borderRadius: 6,
    cursor: "pointer",
  },
  btnSmDanger: {
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 500,
    color: "#dc2626",
    background: "#fff",
    border: "1px solid #fca5a5",
    borderRadius: 6,
    cursor: "pointer",
  },

  // Empty state
  emptyState: {
    padding: "48px 20px",
    textAlign: "center" as const,
    color: "#78766d",
    fontSize: 14,
  },

  // Modal
  modalOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modalContent: {
    background: "#fff",
    borderRadius: 14,
    padding: "24px",
    width: 440,
    maxWidth: "90vw",
    boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
  },
  modalClose: {
    background: "none",
    border: "none",
    fontSize: 22,
    color: "#78766d",
    cursor: "pointer",
    padding: "0 4px",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
  },

  // Form elements
  inputLabel: {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    color: "#1a1a1a",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #e5e5e3",
    borderRadius: 8,
    outline: "none",
    boxSizing: "border-box" as const,
  },

  // Radio cards
  radioCard: {
    display: "block",
    padding: "12px 14px",
    border: "1px solid #e5e5e3",
    borderRadius: 10,
    cursor: "pointer",
    transition: "all 0.12s",
  },
  radioCardActive: {
    borderColor: "#2563a8",
    background: "#f0f5ff",
  },
  radioRow: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "2px solid #d1d5db",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  radioCircleActive: {
    borderColor: "#2563a8",
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#2563a8",
  },
  radioTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#1a1a1a",
    marginBottom: 2,
  },
  radioDesc: {
    fontSize: 12,
    color: "#78766d",
    lineHeight: 1.4,
  },

  errorMsg: {
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 8,
  },
};
