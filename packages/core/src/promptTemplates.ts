import type { ReviewFileRequest } from "./types.js";

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
