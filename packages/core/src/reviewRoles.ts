import type { ReviewRole } from "./types.js";

export function createBuiltInReviewRoles(now = new Date().toISOString()): ReviewRole[] {
  return [
    {
      id: "document-structure",
      group: "documentation-quality",
      name: "文档结构审查员",
      description: "检查章节结构、重复内容、叙述顺序、读者路径和信息组织。",
      focusAreas: ["章节结构", "重复内容", "叙述顺序", "读者路径", "信息组织"],
      defaultSelected: true,
      source: "global",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "fact-consistency",
      group: "documentation-quality",
      name: "事实一致性审查员",
      description: "检查日期、路径、命名、状态、结论、里程碑和引用是否自洽。",
      focusAreas: ["日期", "路径", "命名", "状态", "结论", "里程碑", "引用"],
      defaultSelected: true,
      source: "global",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "actionability",
      group: "product-delivery",
      name: "可执行性审查员",
      description: "检查任务拆解、命令、验收标准、后续动作、交接说明是否可执行。",
      focusAreas: ["任务拆解", "命令", "验收标准", "后续动作", "交接说明"],
      defaultSelected: true,
      source: "global",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "risk-opposition",
      group: "risk-opposition",
      name: "风险/反方审查员",
      description: "寻找隐含假设、遗漏风险、过度承诺、边界不清和反例。",
      focusAreas: ["隐含假设", "遗漏风险", "过度承诺", "边界不清", "反例"],
      defaultSelected: false,
      source: "global",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "language-expression",
      group: "user-perspective",
      name: "语言表达审查员",
      description: "检查措辞、可读性、简洁度、歧义、术语一致性和面向读者的表达质量。",
      focusAreas: ["措辞", "可读性", "简洁度", "歧义", "术语一致性"],
      defaultSelected: false,
      source: "global",
      createdAt: now,
      updatedAt: now
    }
  ];
}
