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

interface Envelope {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// ── API helper ──────────────────────────────────────────────────────────────

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── SVG Icons ───────────────────────────────────────────────────────────────

function BarChartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#a8b5c4"
      strokeWidth="2"
      style={{ marginLeft: 6, cursor: "pointer" }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// ── Sidebar Nav Item ────────────────────────────────────────────────────────

function NavItem({
  icon,
  label,
  active = false,
  activeBorder = false,
  count,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  active?: boolean;
  activeBorder?: boolean;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <div
      style={{
        ...s.navItem,
        ...(active ? s.navItemActive : {}),
        ...(activeBorder ? { borderLeft: "3px solid #2563a8", paddingLeft: 9 } : {}),
      }}
      onClick={onClick}
    >
      {icon && <span style={{ opacity: 0.7, flexShrink: 0, display: "flex" }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      {count !== undefined && (
        <span style={s.countBadge}>{count}</span>
      )}
    </div>
  );
}

// ── Bar Chart (pure CSS) ────────────────────────────────────────────────────

function BarChart({
  sentData,
  completedData,
  labels,
}: {
  sentData: number[];
  completedData: number[];
  labels: string[];
}) {
  const maxVal = Math.max(...sentData, ...completedData, 1);

  return (
    <div>
      <div style={s.chartArea}>
        {labels.map((label, i) => (
          <div key={label} style={s.barGroup}>
            <div style={s.barPair}>
              <div
                style={{
                  ...s.bar,
                  height: `${(sentData[i] / maxVal) * 100}%`,
                  background: "#2563a8",
                }}
              />
              <div
                style={{
                  ...s.bar,
                  height: `${(completedData[i] / maxVal) * 100}%`,
                  background: "#0a6b5c",
                }}
              />
            </div>
            <div style={s.barLabel}>{label}</div>
          </div>
        ))}
      </div>
      <div style={s.legend}>
        <div style={s.legendItem}>
          <div style={{ ...s.legendDot, background: "#2563a8" }} />
          Sent
        </div>
        <div style={s.legendItem}>
          <div style={{ ...s.legendDot, background: "#0a6b5c" }} />
          Completed
        </div>
      </div>
    </div>
  );
}

// ── Rate Tile ───────────────────────────────────────────────────────────────

function RateTile({
  value,
  label,
  bg,
  color,
}: {
  value: string;
  label: string;
  bg: string;
  color: string;
}) {
  return (
    <div style={{ ...s.rateTile, background: bg }}>
      <div style={{ ...s.rateValue, color }}>{value}</div>
      <div style={{ ...s.rateLabel, color }}>{label}</div>
    </div>
  );
}

// ── Main Reports Page ───────────────────────────────────────────────────────

export default function ReportsPage() {
  const [activeNav, setActiveNav] = useState("admin-dashboard");
  const [stats, setStats] = useState<Stats | null>(null);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [s, envs] = await Promise.all([
        api<Stats>("/api/admin/stats"),
        api<Envelope[]>("/api/envelopes"),
      ]);
      setStats(s);
      setEnvelopes(envs);
    } catch {}
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Computed stats
  const total = stats?.envelopes ?? 24;
  const completed = envelopes.filter((e) => e.status === "completed").length || 21;
  const declined = envelopes.filter(
    (e) => e.status === "declined" || e.status === "voided"
  ).length || 2;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 87;
  const sent = envelopes.filter((e) => e.status === "sent").length;
  const inProgressRate = total > 0 ? Math.round((sent / total) * 100) : 11;
  const declinedRate = total > 0 ? Math.round((declined / total) * 100) : 2;

  // Mock monthly data for bar chart (Jan–Jun)
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const sentByMonth = [3, 5, 6, 8, 10, 12];
  const completedByMonth = [2, 4, 5, 7, 9, 11];

  return (
    <div style={s.layout}>
      {/* ── Left Sidebar ── */}
      <aside style={s.sidebar}>
        {/* Dashboards section */}
        <div style={s.sidebarSection}>
          <div style={s.sidebarLabel}>Dashboards</div>
          <NavItem
            icon={<DashboardIcon />}
            label="My dashboard"
            active={activeNav === "my-dashboard"}
            onClick={() => setActiveNav("my-dashboard")}
          />
          <NavItem
            icon={<BarChartIcon />}
            label="Administrator dashboard"
            active={activeNav === "admin-dashboard"}
            activeBorder={activeNav === "admin-dashboard"}
            onClick={() => setActiveNav("admin-dashboard")}
          />
        </div>

        {/* Report Type section */}
        <div style={s.sidebarSection}>
          <div style={s.sidebarLabel}>Report Type</div>
          <NavItem label="All" count={17} active={false} onClick={() => {}} />
          <NavItem label="Envelope" count={8} onClick={() => {}} />
          <NavItem label="Recipient" count={2} onClick={() => {}} />
          <NavItem label="Usage" count={7} onClick={() => {}} />
          <NavItem label="Custom" count={0} onClick={() => {}} />
          <NavItem label="Downloads" onClick={() => {}} />
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div style={s.main}>
        {/* Page title bar */}
        <div style={s.titleBar}>
          <div style={s.titleRow}>
            <h1 style={s.pageTitle}>Administrator Dashboard</h1>
            <InfoIcon />
          </div>
        </div>

        <div style={s.content}>
          {/* ── 4 Stat Cards ── */}
          <div style={s.statsGrid}>
            <div style={s.statCard}>
              <div style={s.statLabel}>Total Envelopes</div>
              <div style={s.statValue}>{total}</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statLabel}>Completion Rate</div>
              <div style={s.statValue}>{rate}%</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statLabel}>Avg Time to Sign</div>
              <div style={s.statValue}>4.2h</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statLabel}>Declined / Voided</div>
              <div style={{ ...s.statValue, color: "#8b2e2e" }}>{declined}</div>
            </div>
          </div>

          {/* ── Bar Chart Card ── */}
          <div style={s.card}>
            <div style={s.cardHeader}>
              <h3 style={s.cardTitle}>Envelope Usage</h3>
              <select style={s.periodSelect}>
                <option>Last 6 months</option>
                <option>Last 12 months</option>
                <option>This year</option>
              </select>
            </div>
            <div style={s.cardBody}>
              <BarChart
                sentData={sentByMonth}
                completedData={completedByMonth}
                labels={months}
              />
            </div>
          </div>

          {/* ── Success Rate Card ── */}
          <div style={s.card}>
            <div style={s.cardHeader}>
              <h3 style={s.cardTitle}>Envelope Success Rate</h3>
            </div>
            <div style={s.cardBody}>
              <div style={s.rateGrid}>
                <RateTile
                  value={`${rate}%`}
                  label="Success Rate"
                  bg="#d4ede8"
                  color="#0a6b5c"
                />
                <RateTile
                  value={`${inProgressRate}%`}
                  label="In Progress"
                  bg="#fdf0d4"
                  color="#a87c0a"
                />
                <RateTile
                  value={`${declinedRate}%`}
                  label="Declined / Void"
                  bg="#fce8e8"
                  color="#8b2e2e"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  // Layout
  layout: {
    display: "flex",
    minHeight: "calc(100vh - 56px)",
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#0f1923",
  },

  // Sidebar
  sidebar: {
    width: 220,
    background: "#fff",
    borderRight: "1px solid rgba(15,25,35,0.09)",
    padding: "12px 0",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  sidebarSection: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 1,
    padding: "0 8px",
  },
  sidebarLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "#a8b5c4",
    padding: "10px 12px 4px",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 6,
    fontSize: 13,
    color: "#2c3e50",
    cursor: "pointer",
    transition: "all 0.12s",
    borderLeft: "3px solid transparent",
  },
  navItemActive: {
    background: "#e8f0fb",
    color: "#2563a8",
    fontWeight: 600,
  },
  countBadge: {
    fontSize: 11,
    color: "#a8b5c4",
    fontWeight: 500,
  },

  // Main
  main: {
    flex: 1,
    background: "#f7f6f4",
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },

  // Title bar
  titleBar: {
    padding: "18px 24px 0",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
  },

  // Content
  content: {
    flex: 1,
    padding: 24,
    overflowY: "auto" as const,
  },

  // Stats grid
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    background: "#fff",
    border: "1px solid rgba(15,25,35,0.09)",
    borderRadius: 16,
    padding: "20px 18px",
  },
  statLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: "#6b7c93",
    marginBottom: 6,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    color: "#0f1923",
    lineHeight: 1,
  },

  // Card
  card: {
    background: "#fff",
    border: "1px solid rgba(15,25,35,0.09)",
    borderRadius: 16,
    marginBottom: 16,
    overflow: "hidden",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    borderBottom: "1px solid rgba(15,25,35,0.09)",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    margin: 0,
  },
  cardBody: {
    padding: 20,
  },
  periodSelect: {
    padding: "5px 10px",
    fontSize: 12,
    border: "1px solid rgba(15,25,35,0.09)",
    borderRadius: 6,
    background: "#fff",
    color: "#6b7c93",
    cursor: "pointer",
  },

  // Bar chart
  chartArea: {
    display: "flex",
    alignItems: "flex-end",
    gap: 20,
    height: 200,
    padding: "0 12px",
    borderBottom: "1px solid rgba(15,25,35,0.09)",
    marginBottom: 16,
  },
  barGroup: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 8,
    height: "100%",
  },
  barPair: {
    display: "flex",
    gap: 4,
    alignItems: "flex-end",
    flex: 1,
    width: "100%",
    justifyContent: "center",
  },
  bar: {
    width: 24,
    borderRadius: "4px 4px 0 0",
    minHeight: 4,
    transition: "height 0.3s ease",
  },
  barLabel: {
    fontSize: 11,
    color: "#6b7c93",
    fontWeight: 500,
  },
  legend: {
    display: "flex",
    gap: 20,
    justifyContent: "center",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "#6b7c93",
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },

  // Rate tiles
  rateGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 14,
  },
  rateTile: {
    borderRadius: 12,
    padding: "24px 20px",
    textAlign: "center" as const,
  },
  rateValue: {
    fontSize: 32,
    fontWeight: 700,
    lineHeight: 1,
    marginBottom: 6,
  },
  rateLabel: {
    fontSize: 13,
    fontWeight: 500,
  },
};
