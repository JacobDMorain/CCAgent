import type { PromptTemplate, ReviewFileRequest } from "./types.js";

export function buildReviewFilePrompt(request: ReviewFileRequest): string {
  const style = request.reviewStyle ?? "full";
  const languageInstruction = request.language
    ? `Return the result in ${request.language}.`
    : "If request.language is not provided, use Chinese unless the file itself clearly requires another language.";

  return `You are reviewing a local document for the user.

Task:
Review the file: ${request.file}

Review style: ${style}

${languageInstruction}
Lead with findings ordered by severity. For each issue include:
- title
- evidence from the file
- why it matters
- suggested change

If no actionable issues are found, say that clearly and mention any residual uncertainty.
Do not modify the file.`;
}

export function buildRunTaskPrompt(prompt: string): string {
  return `Execute the following task in the working directory.

${prompt}

Return the final answer clearly. If you inspect or modify files, summarize the exact files involved.`;
}

export function renderPromptTemplate(template: string, variables: Record<string, string | undefined>): string {
  const missing = Array.from(template.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g))
    .map((match) => match[1])
    .filter((name, index, names) => names.indexOf(name) === index)
    .filter((name) => variables[name] === undefined || variables[name] === "");

  if (missing.length > 0) {
    throw new Error(`missing template variables: ${missing.join(", ")}`);
  }

  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_match, name: string) => variables[name] ?? "");
}

export function createDefaultPromptTemplates(now = new Date().toISOString()): PromptTemplate[] {
  return [
    {
      id: "default-claude-review-full",
      kind: "claude-review",
      name: "Full Claude Review",
      description: "Review the target document and return actionable findings without modifying files.",
      version: 2,
      content: [
        "You are reviewing a local document for the user.",
        "",
        "Provider: {provider}",
        "Target file: {file}",
        "Workspace root: {workspaceRoot}",
        "Review style: {reviewStyle}",
        "Language: {language}",
        "",
        "Role team:",
        "{roleTeam}",
        "",
        "Use the selected role team as review perspectives. You may organize the answer by role when useful, but do not force a rigid format if a combined review is clearer.",
        "Make clear which role perspective raised each important finding when that helps Codex adjudicate the feedback later.",
        "",
        "Lead with findings ordered by severity. For each issue include:",
        "- title",
        "- evidence from the file",
        "- why it matters",
        "- suggested change",
        "",
        "If no actionable issues are found, say that clearly.",
        "Do not modify the file."
      ].join("\n"),
      requiredVariables: ["provider", "file", "workspaceRoot", "reviewStyle", "language", "roleTeam"],
      isDefault: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "default-codex-edit",
      kind: "codex-edit",
      name: "Codex Edit From Review Packet",
      description: "Ask Codex CLI to adjudicate multi-provider review findings and edit the CCAgent-selected target document when justified.",
      version: 2,
      content: [
        "You are the Codex editing stage in a CCAgent multi-provider review workflow.",
        "Your job is to adjudicate the provider review findings, decide which findings are correct and worth applying, then edit the CCAgent-selected target document.",
        "",
        "Run id: {runId}",
        "Target document: {targetDocument}",
        "Workspace root: {workspaceRoot}",
        "Review packet: {reviewPacket}",
        "Failed providers: {failedProviders}",
        "",
        "The review packet is an audit packet, not a semantic summary. CCAgent preserves provider outputs mostly as raw text.",
        "Provider outputs may or may not be role grouped. Infer role perspectives, duplicate findings, conflicts, and missing coverage yourself from the assigned role team and raw provider outputs.",
        "Evaluate each provider or role-perspective finding independently. A finding is not automatically correct just because a role or provider raised it.",
        "",
        "Read the review packet and the target document first. You may inspect surrounding repository context when it helps judge whether a provider finding is correct.",
        "Do not replace the target document with a different file, even if another file looks more canonical or similar. If context suggests the target is probably the wrong file, report that concern instead of silently editing another file.",
        "Only edit {targetDocument} unless a review finding explicitly requires a small supporting edit in another file and you can justify it.",
        "Apply changes only for concrete, justified review findings that survive your own review. Do not apply provider suggestions mechanically.",
        "After editing, summarize the files changed, which provider findings you applied, and which review suggestions you intentionally rejected or deferred."
      ].join("\n"),
      requiredVariables: ["runId", "targetDocument", "workspaceRoot", "reviewPacket", "failedProviders"],
      isDefault: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "default-claude-review-full-zh",
      kind: "claude-review",
      name: "完整 Claude 评审",
      description: "评审目标文档，返回可执行的问题和修改建议，不直接修改文件。",
      version: 2,
      content: [
        "你正在为用户评审一个本地文档。",
        "",
        "Provider: {provider}",
        "Target file: {file}",
        "Workspace root: {workspaceRoot}",
        "Review style: {reviewStyle}",
        "Language: {language}",
        "",
        "角色小组:",
        "{roleTeam}",
        "",
        "请把选中的角色小组作为评审视角。必要时可以按角色组织输出，但如果综合评审更清楚，不需要强制套用固定格式。",
        "当某个重要问题明显来自特定角色视角时，请说明这一点，方便后续 Codex 判断。",
        "",
        "请使用中文输出。请按严重程度排序列出发现的问题。每个问题包含：",
        "- 标题",
        "- 来自文件的证据",
        "- 为什么重要",
        "- 建议如何修改",
        "",
        "如果没有可执行的问题，请明确说明。",
        "不要修改文件。"
      ].join("\n"),
      requiredVariables: ["provider", "file", "workspaceRoot", "reviewStyle", "language", "roleTeam"],
      isDefault: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "default-codex-edit-zh",
      kind: "codex-edit",
      name: "Codex 根据评审包修改文档",
      description: "让 Codex CLI 审核多个 provider 的评审意见，并在有充分理由时修改 CCAgent 指定的目标文档。",
      version: 2,
      content: [
        "你是 CCAgent 多 provider 评审流程中的 Codex 修改阶段。",
        "你的任务是审核各 provider 的评审意见，判断哪些意见正确且值得采纳，然后修改 CCAgent 指定的目标文档。",
        "",
        "Run id: {runId}",
        "Target document: {targetDocument}",
        "Workspace root: {workspaceRoot}",
        "Review packet: {reviewPacket}",
        "Failed providers: {failedProviders}",
        "",
        "Review packet 是审计材料包，不是语义总结。CCAgent 会尽量保留 provider 原始输出。",
        "Provider 输出可能按角色分组，也可能没有。请你根据已分配的角色小组和 provider 原始输出，自行判断角色视角、重复意见、冲突意见和遗漏覆盖。",
        "请独立判断每个 provider 或角色视角提出的意见，不要因为某个角色或 provider 提出就机械采纳。",
        "",
        "请先读取 review packet 和目标文档。你可以扫描周边仓库内容，用于判断 provider 意见是否成立。",
        "不要把目标文档替换成其它文件，即使其它文件看起来更权威或更相似。如果上下文显示目标文件可能选错了，请报告这个风险，而不是静默修改其它文件。",
        "除非某条评审意见明确要求少量配套修改且你能说明理由，否则只允许修改 {targetDocument}。",
        "只采纳经过你复核后仍然具体、正确、值得执行的评审意见。不要机械套用 provider 建议。",
        "如果本轮你实际修改了文件，请尽量在 Continue Decision 中选择 continue: yes，让 provider 再评审一轮；除非你有充分理由认为无需复审。",
        "",
        "完成修改后，请使用中文输出面向用户的总结，并说明：",
        "- 修改了哪些文件",
        "- 采纳了哪些 provider 意见",
        "- 拒绝或延后了哪些建议以及原因",
        "",
        "最后必须包含以下机器可解析区块，字段名和值保持英文：",
        "## Continue Decision",
        "continue: yes|no",
        "reason: ...",
        "confidence: high|medium|low",
        "next_focus:",
        "- ...",
        "risk_flags:",
        "- ..."
      ].join("\n"),
      requiredVariables: ["runId", "targetDocument", "workspaceRoot", "reviewPacket", "failedProviders"],
      isDefault: true,
      createdAt: now,
      updatedAt: now
    }
  ];
}
