import path from "node:path";
import { CCAgentError, ErrorCodes } from "./errors.js";

export function normalizeWorkspacePath(input: string): string {
  return path.resolve(input).replace(/\\/g, "/");
}

export function assertCwdAllowed(cwd: string, allowedRoots: string[]): string {
  const normalizedCwd = normalizeWorkspacePath(cwd);
  const normalizedRoots = allowedRoots.map(normalizeWorkspacePath);
  const allowed = normalizedRoots.some((root) => isSameOrInside(normalizedCwd, root));

  if (!allowed) {
    throw new CCAgentError(
      ErrorCodes.PathDenied,
      `cwd is outside allowed workspace roots: ${normalizedCwd}`
    );
  }

  return normalizedCwd;
}

export function assertFileInsideCwd(cwd: string, file: string): string {
  const normalizedCwd = normalizeWorkspacePath(cwd);
  const filePath = path.isAbsolute(file) ? file : path.join(normalizedCwd, file);
  const normalizedFile = normalizeWorkspacePath(filePath);

  if (!isSameOrInside(normalizedFile, normalizedCwd)) {
    throw new CCAgentError(ErrorCodes.PathDenied, `file is outside cwd: ${normalizedFile}`);
  }

  return normalizedFile;
}

function isSameOrInside(candidate: string, root: string): boolean {
  const normalizedRoot = root.endsWith("/") ? root.slice(0, -1) : root;
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`);
}
