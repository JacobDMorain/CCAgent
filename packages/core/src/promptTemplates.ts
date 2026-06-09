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
      version: 1,
      content: [
        "You are reviewing a local document for the user.",
        "",
        "Provider: {provider}",
        "Target file: {file}",
        "Workspace root: {workspaceRoot}",
        "Review style: {reviewStyle}",
        "Language: {language}",
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
      requiredVariables: ["provider", "file", "workspaceRoot", "reviewStyle", "language"],
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
    }
  ];
}
