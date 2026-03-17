"use client";

import React, { useState, useEffect, useCallback } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

interface Envelope {
  id: string;
  title: string;
  status: string;
  total_signers: number;
  signed_count: number;
  completed_at?: string;
  updated_at: string;
  created_at: string;
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── SVG Icons ───────────────────────────────────────────────────────────────

function PersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21a8 8 0 1 0-16 0" />
    </svg>
  );
}

function SharedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function WorkflowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M17.5 14v7M14 17.5h7" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563a8" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

// ── Illustration for hero card ──────────────────────────────────────────────

function TemplateIllustration() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
      {/* Document stack */}
      <rect x="28" y="18" width="64" height="84" rx="6" fill="#fff" stroke="#c4d5e8" strokeWidth="1.5" />
      <rect x="24" y="14" width="64" height="84" rx="6" fill="#fff" stroke="#a8c4e0" strokeWidth="1.5" />
      <rect x="20" y="10" width="64" height="84" rx="6" fill="#fff" stroke="#2563a8" strokeWidth="2" />
      {/* Lines on front doc */}
      <line x1="32" y1="30" x2="72" y2="30" stroke="#c4d5e8" strokeWidth="2" strokeLinecap="round" />
      <line x1="32" y1="40" x2="68" y2="40" stroke="#e0e8f0" strokeWidth="2" strokeLinecap="round" />
      <line x1="32" y1="50" x2="60" y2="50" stroke="#e0e8f0" strokeWidth="2" strokeLinecap="round" />
      <line x1="32" y1="60" x2="64" y2="60" stroke="#e0e8f0" strokeWidth="2" strokeLinecap="round" />
      {/* Checkmark circle */}
      <circle cx="82" cy="78" r="16" fill="#2563a8" />
      <polyline points="74,78 80,84 90,72" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Sidebar Nav Item ────────────────────────────────────────────────────────

function NavItem({
  icon,
  label,
  active = false,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <div
      style={{
        ...s.navItem,
        ...(active ? s.navItemActive : {}),
      }}
      onClick={onClick}
    >
      <span style={{ opacity: 0.7, flexShrink: 0, display: "flex" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge && (
        <span style={s.newBadge}>{badge}</span>
      )}
    </div>
  );
}

// ── Main Templates Page ─────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [activeNav, setActiveNav] = useState("my");
  const [recentEnvelopes, setRecentEnvelopes] = useState<Envelope[]>([]);
  const [searchValue, setSearchValue] = useState("");

  const loadRecent = useCallback(async () => {
    try {
      const envs = await api<Envelope[]>("/api/envelopes?status=completed");
      setRecentEnvelopes(envs.slice(0, 3));
    } catch {}
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  return (
    <div style={s.layout}>
      {/* ── Left Sidebar ── */}
      <aside style={s.sidebar}>
        <button style={s.createBtn}>Create Template</button>

        <div style={s.navSection}>
          <div style={s.navLabel}>ENVELOPE TEMPLATES</div>
          <NavItem
            icon={<PersonIcon />}
            label="My Templates"
            active={activeNav === "my"}
            onClick={() => setActiveNav("my")}
          />
          <NavItem
            icon={<SharedIcon />}
            label="Shared with Me"
            active={activeNav === "shared"}
            onClick={() => setActiveNav("shared")}
          />
          <NavItem
            icon={<StarIcon />}
            label="Favorites"
            active={activeNav === "favorites"}
            onClick={() => setActiveNav("favorites")}
          />
          <div style={s.showMore}>Show More</div>
        </div>

        <div style={s.navSection}>
          <NavItem
            icon={<WorkflowIcon />}
            label="Workflow Templates"
            active={activeNav === "workflow"}
            badge="NEW"
            onClick={() => setActiveNav("workflow")}
          />
          <NavItem
            icon={<GalleryIcon />}
            label="Template Gallery"
            active={activeNav === "gallery"}
            badge="NEW"
            onClick={() => setActiveNav("gallery")}
          />
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div style={s.main}>
        {/* Search toolbar */}
        <div style={s.toolbar}>
          <div style={s.searchWrap}>
            <span style={s.searchIcon}><SearchIcon /></span>
            <input
              type="text"
              placeholder="Search templates..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              style={s.searchInput}
            />
          </div>
          <div style={s.toolbarActions}>
            <button style={s.filterBtn}>
              Date
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <button style={s.filterBtn}>Advanced search</button>
            <button style={s.clearBtn}>Clear</button>
          </div>
        </div>

        {/* Content area */}
        <div style={s.content}>
          {/* ── Hero / Promo Card ── */}
          <div style={s.heroCard}>
            <div style={s.heroIllustration}>
              <TemplateIllustration />
            </div>
            <div style={s.heroContent}>
              <h2 style={s.heroHeading}>Resending the same envelopes?</h2>
              <p style={s.heroDesc}>
                Save documents, placeholder recipients and fields as a template so you can save time.
              </p>
              <div style={s.heroActions}>
                <button style={s.btnPrimary}>Create a Template</button>
                <a href="#" style={s.browseLink}>Browse starter templates</a>
              </div>
            </div>
          </div>

          {/* ── Recent Envelopes Section ── */}
          <div style={s.recentSection}>
            <h3 style={s.recentHeading}>Save a recent envelope as a template</h3>
            <div style={s.recentList}>
              {recentEnvelopes.length === 0 ? (
                /* Show a placeholder row even if API returns nothing */
                <div style={s.docRow}>
                  <div style={s.docRowLeft}>
                    <div style={s.docIcon}><FileIcon /></div>
                    <div>
                      <div style={s.docName}>NDA — Acme Corp</div>
                      <div style={s.docMeta}>2 recipients &middot; Completed Oct 15, 2025</div>
                    </div>
                  </div>
                  <button style={s.btnSecondary}>Save as a Template</button>
                </div>
              ) : (
                recentEnvelopes.map((env) => (
                  <div key={env.id} style={s.docRow}>
                    <div style={s.docRowLeft}>
                      <div style={s.docIcon}><FileIcon /></div>
                      <div>
                        <div style={s.docName}>{env.title || "Untitled"}</div>
                        <div style={s.docMeta}>
                          {env.total_signers || 0} recipient{(env.total_signers || 0) !== 1 ? "s" : ""} &middot; Completed {fmtDate(env.completed_at || env.updated_at)}
                        </div>
                      </div>
                    </div>
                    <button style={s.btnSecondary}>Save as a Template</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Pagination ── */}
        <div style={s.pagination}>
          <div style={s.paginationLeft}>
            <select style={s.pageSelect}>
              <option>25 / Page</option>
              <option>50 / Page</option>
              <option>100 / Page</option>
            </select>
          </div>
          <div style={s.paginationRight}>
            <button style={s.pageBtn} disabled><ChevronLeft /></button>
            <span style={s.pageNumber}>1</span>
            <button style={s.pageBtn} disabled><ChevronRight /></button>
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
    padding: "20px 16px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  createBtn: {
    width: "100%",
    padding: "12px",
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
    background: "#0f1923",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
  },
  navSection: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "#a8b5c4",
    padding: "8px 12px 4px",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 6,
    fontSize: 14,
    color: "#2c3e50",
    cursor: "pointer",
    transition: "all 0.12s",
  },
  navItemActive: {
    background: "#e8f0fb",
    color: "#2563a8",
    fontWeight: 600,
  },
  showMore: {
    fontSize: 13,
    color: "#2563a8",
    padding: "6px 12px",
    cursor: "pointer",
    fontWeight: 500,
  },
  newBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: "#2563a8",
    background: "#e8f0fb",
    padding: "2px 6px",
    borderRadius: 4,
    letterSpacing: "0.04em",
  },

  // Main area
  main: {
    flex: 1,
    background: "#f7f6f4",
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },

  // Search toolbar
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 24px",
    background: "#fff",
    borderBottom: "1px solid rgba(15,25,35,0.09)",
  },
  searchWrap: {
    position: "relative" as const,
    flex: 1,
    maxWidth: 400,
  },
  searchIcon: {
    position: "absolute" as const,
    left: 10,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#a8b5c4",
    display: "flex",
  },
  searchInput: {
    width: "100%",
    padding: "8px 12px 8px 34px",
    fontSize: 13,
    border: "1px solid rgba(15,25,35,0.09)",
    borderRadius: 8,
    outline: "none",
    background: "#f7f6f4",
    color: "#0f1923",
  },
  toolbarActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  filterBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 500,
    color: "#6b7c93",
    background: "none",
    border: "1px solid rgba(15,25,35,0.09)",
    borderRadius: 6,
    cursor: "pointer",
  },
  clearBtn: {
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 500,
    color: "#2563a8",
    background: "none",
    border: "none",
    cursor: "pointer",
  },

  // Content
  content: {
    flex: 1,
    padding: 24,
    overflowY: "auto" as const,
  },

  // Hero promo card
  heroCard: {
    display: "flex",
    alignItems: "center",
    gap: 36,
    background: "#e8f0fb",
    borderRadius: 16,
    padding: 32,
    marginBottom: 32,
    flexWrap: "wrap" as const,
  },
  heroIllustration: {
    flexShrink: 0,
  },
  heroContent: {
    flex: 1,
    minWidth: 240,
  },
  heroHeading: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: 20,
    fontStyle: "italic" as const,
    color: "#0f1923",
    marginBottom: 8,
  },
  heroDesc: {
    fontSize: 13,
    color: "#6b7c93",
    lineHeight: 1.6,
    marginBottom: 16,
  },
  heroActions: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap" as const,
  },
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
    background: "#2563a8",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
  },
  browseLink: {
    fontSize: 13,
    fontWeight: 500,
    color: "#2563a8",
    textDecoration: "none",
    cursor: "pointer",
  },

  // Recent section
  recentSection: {
    borderTop: "1px solid rgba(15,25,35,0.09)",
    paddingTop: 24,
  },
  recentHeading: {
    fontSize: 15,
    fontWeight: 500,
    color: "#0f1923",
    marginBottom: 16,
  },
  recentList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },

  // Document row
  docRow: {
    background: "#fff",
    border: "1px solid rgba(15,25,35,0.09)",
    borderRadius: 12,
    padding: "14px 18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  docRowLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    minWidth: 0,
  },
  docIcon: {
    flexShrink: 0,
    width: 40,
    height: 40,
    background: "#e8f0fb",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  docName: {
    fontSize: 13,
    fontWeight: 500,
    color: "#0f1923",
  },
  docMeta: {
    fontSize: 11,
    color: "#a8b5c4",
    marginTop: 2,
  },
  btnSecondary: {
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 500,
    color: "#0f1923",
    background: "#fff",
    border: "1px solid rgba(15,25,35,0.09)",
    borderRadius: 8,
    cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap" as const,
  },

  // Pagination
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 24px",
    borderTop: "1px solid rgba(15,25,35,0.09)",
    background: "#fff",
    fontSize: 13,
    color: "#6b7c93",
  },
  paginationLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  pageSelect: {
    padding: "4px 8px",
    fontSize: 13,
    border: "1px solid rgba(15,25,35,0.09)",
    borderRadius: 6,
    background: "#fff",
    color: "#0f1923",
    cursor: "pointer",
  },
  paginationRight: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  pageBtn: {
    width: 28,
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "1px solid rgba(15,25,35,0.09)",
    borderRadius: 6,
    cursor: "pointer",
    color: "#6b7c93",
  },
  pageNumber: {
    padding: "4px 10px",
    fontSize: 13,
    fontWeight: 600,
    color: "#0f1923",
  },
};
