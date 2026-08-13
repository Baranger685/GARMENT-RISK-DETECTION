export function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  const label = level.charAt(0).toUpperCase() + level.slice(1);
  return <span className={`badge badge-${level}`}>{label} Risk</span>;
}

export function FlaggedBadge() {
  return <span className="badge badge-flagged">⚑ Flagged</span>;
}

// Efficiency category (High / Medium / Risk) reuses the same badge color
// scale as RiskBadge: High -> green, Medium -> amber, Risk -> red.
const CATEGORY_STYLE: Record<"high" | "medium" | "risk", "low" | "medium" | "high"> = {
  high: "low",
  medium: "medium",
  risk: "high",
};

export function EfficiencyCategoryBadge({ category }: { category: "high" | "medium" | "risk" }) {
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  return <span className={`badge badge-${CATEGORY_STYLE[category]}`}>{label} Efficiency</span>;
}
