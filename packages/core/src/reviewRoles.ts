import type { ReviewRole } from "./types.js";

export function createBuiltInReviewRoles(now = new Date().toISOString()): ReviewRole[] {
  return [
    {
      id: "document-structure",
      name: "文档结构审查员",
      description: "检查章节结构、重复内容、叙述顺序、读者路径和信息组织。",
      prompt: "你负责从文档结构角度审查目标文档，重点关注章节结构、重复内容、叙述顺序、读者路径、信息层级和缺失的结构连接。只提出具体、可执行的结构问题。",
      focusAreas: ["章节结构", "重复内容", "叙述顺序", "读者路径", "信息组织"],
      outputInstructions: "请使用 `## Role: 文档结构审查员` 作为本角色输出标题；如果没有可执行问题，请明确说明。",
      defaultSelected: true,
      source: "global",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "fact-consistency",
      name: "事实一致性审查员",
      description: "检查日期、路径、命名、状态、结论、里程碑和引用是否自洽。",
      prompt: "你负责从事实一致性角度审查目标文档，重点核对日期、文件路径、命名、状态描述、结论、里程碑、引用和前后表述是否互相矛盾。",
      focusAreas: ["日期", "路径", "命名", "状态", "结论", "里程碑", "引用"],
      outputInstructions: "请使用 `## Role: 事实一致性审查员` 作为本角色输出标题；每个发现都要指出冲突位置或不一致证据。",
      defaultSelected: true,
      source: "global",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "actionability",
      name: "可执行性审查员",
      description: "检查任务拆解、命令、验收标准、后续动作、交接说明是否可执行。",
      prompt: "你负责从可执行性角度审查目标文档，重点判断任务、命令、验收标准、后续动作和交接说明是否足够明确，读者是否能按文档行动。",
      focusAreas: ["任务拆解", "命令", "验收标准", "后续动作", "交接说明"],
      outputInstructions: "请使用 `## Role: 可执行性审查员` 作为本角色输出标题；优先提出会阻碍执行或验收的问题。",
      defaultSelected: true,
      source: "global",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "risk-opposition",
      name: "风险/反方审查员",
      description: "寻找隐含假设、遗漏风险、过度承诺、边界不清和反例。",
      prompt: "你负责扮演风险和反方审查角色，专门寻找隐含假设、遗漏风险、过度承诺、边界不清、反例和可能误导读者的表述。",
      focusAreas: ["隐含假设", "遗漏风险", "过度承诺", "边界不清", "反例"],
      outputInstructions: "请使用 `## Role: 风险/反方审查员` 作为本角色输出标题；避免泛泛而谈，只列可被文档修改缓解的风险。",
      defaultSelected: false,
      source: "global",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "language-expression",
      name: "语言表达审查员",
      description: "检查措辞、可读性、简洁度、歧义、术语一致性和面向读者的表达质量。",
      prompt: "你负责从语言表达角度审查目标文档，重点关注措辞、可读性、简洁度、歧义、术语一致性和面向读者的表达质量。",
      focusAreas: ["措辞", "可读性", "简洁度", "歧义", "术语一致性"],
      outputInstructions: "请使用 `## Role: 语言表达审查员` 作为本角色输出标题；只提出会明显改善理解质量的表达问题。",
      defaultSelected: false,
      source: "global",
      createdAt: now,
      updatedAt: now
    }
  ];
}
