import type { ReviewRole } from "@ccagent/core";
import type { Locale } from "./i18n.js";

export interface ReviewRoleGroup {
  id: string;
  label: string;
  roles: ReviewRole[];
}

const groupOrder = [
  "core-technology",
  "documentation-quality",
  "product-delivery",
  "user-perspective",
  "risk-opposition",
  "business-operations",
  "custom"
];

const groupLabels: Record<string, Record<Locale, string>> = {
  "core-technology": {
    en: "Core Technology",
    zh: "核心技术组"
  },
  "documentation-quality": {
    en: "Documentation Quality",
    zh: "文档质量组"
  },
  "product-delivery": {
    en: "Product Delivery",
    zh: "产品落地组"
  },
  "user-perspective": {
    en: "User Perspective",
    zh: "用户视角组"
  },
  "risk-opposition": {
    en: "Risk And Opposition",
    zh: "风险与反方组"
  },
  "business-operations": {
    en: "Business Operations",
    zh: "商业运营组"
  },
  custom: {
    en: "Custom",
    zh: "自定义组"
  }
};

export function groupReviewRoles(roles: ReviewRole[], locale: Locale): ReviewRoleGroup[] {
  const grouped = new Map<string, ReviewRole[]>();
  for (const role of roles) {
    const group = role.group || "custom";
    grouped.set(group, [...(grouped.get(group) ?? []), role]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => groupSortKey(left) - groupSortKey(right) || left.localeCompare(right))
    .map(([id, groupedRoles]) => ({
      id,
      label: reviewRoleGroupLabel(id, locale),
      roles: groupedRoles
    }));
}

export function reviewRoleGroupLabel(group: string, locale: Locale): string {
  return groupLabels[group]?.[locale] ?? titleCase(group);
}

function groupSortKey(group: string): number {
  const index = groupOrder.indexOf(group);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
