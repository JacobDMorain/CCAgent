import { useEffect, useMemo, useState } from "react";
import type { AutomationRunRecord, PromptTemplate, ProviderConfig } from "@ccagent/core";
import { ProvidersPage } from "./routes/ProvidersPage.js";
import { ReviewWorkspacePage } from "./routes/ReviewWorkspacePage.js";
import { RunsPage } from "./routes/RunsPage.js";
import { TemplatesPage } from "./routes/TemplatesPage.js";
import { TasksPage } from "./routes/TasksPage.js";
import { formatOutput, formatRunDecisionSummary, toRuntimeError, upsertProvider } from "./guiLogic.js";
import type { GuiApi, GuiTaskRecord } from "./types.js";

export interface AppProps {
  initialProviders?: ProviderConfig[];
  initialTasks?: GuiTaskRecord[];
  initialRuns?: AutomationRunRecord[];
  initialTemplates?: PromptTemplate[];
  initialWorkspaceRoots?: string[];
  daemonError?: { code: string; message: string };
}

export function App({
  initialProviders = [],
  initialTasks = [],
  initialRuns = [],
  initialTemplates = [],
  initialWorkspaceRoots = [],
  daemonError
}: AppProps) {
  const api = typeof window === "undefined" ? undefined : window.ccagent;
  const [providers, setProviders] = useState(initialProviders);
  const [tasks, setTasks] = useState(initialTasks);
  const [runs, setRuns] = useState(initialRuns);
  const [templates, setTemplates] = useState(initialTemplates);
  const [workspaceRoots, setWorkspaceRoots] = useState(initialWorkspaceRoots);
  const [claudePath, setClaudePath] = useState("claude");
  const [codexPath, setCodexPath] = useState("codex.cmd");
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(
    initialProviders[0]?.id
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [runtimeError, setRuntimeError] = useState(daemonError);
  const [selectedOutput, setSelectedOutput] = useState<{ kind: "run" | "task"; id: string; content: string } | undefined>();
  const [selectedRunStatus, setSelectedRunStatus] = useState<{ id: string; content: string } | undefined>();

  useEffect(() => {
    if (!api) {
      return;
    }

    void refreshProviders(api, setProviders, setSelectedProviderId, setRuntimeError);
    void refreshTasks(api, setTasks, setRuntimeError);
    void refreshTemplates(api, setTemplates, setRuntimeError);
    void refreshRuns(api, setRuns, setRuntimeError);
    void refreshRuntimeSettings(api, setClaudePath, setCodexPath, setWorkspaceRoots, setRuntimeError);

    const timer = window.setInterval(() => {
      void refreshTasks(api, setTasks, setRuntimeError);
      void refreshRuns(api, setRuns, setRuntimeError);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [api]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId]
  );

  return (
    <main className="app-shell">
      <nav className="sidebar" aria-label="Primary">
        <h1>CCAgent</h1>
        <a href="#review-workspace">Review Workspace</a>
        <a href="#providers">Providers</a>
        <a href="#templates">Prompt Templates</a>
        <a href="#runs">Runs</a>
        <a href="#tasks">Tasks</a>
        <a href="#settings">Settings</a>
      </nav>
      <div className="workspace">
        <ReviewWorkspacePage
          providers={providers}
          templates={templates}
          onStart={async (request) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, "Starting automation run...", async () => {
              const nextRoots = Array.from(new Set([...workspaceRoots, request.cwd]));
              if (nextRoots.length !== workspaceRoots.length) {
                const settings = await api.setWorkspaceRoots(nextRoots);
                setWorkspaceRoots(settings.allowedRoots);
              }
              const run = await api.createAutomationRun(request);
              setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
              return `Started automation run ${run.id}`;
            });
          }}
        />
        <ProvidersPage
          providers={providers}
          selectedProviderId={selectedProvider?.id}
          onSelectProvider={setSelectedProviderId}
          onSaveProvider={async (provider, apiKey) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Saving provider ${provider.id}...`, async () => {
              const saved = await api.saveProvider(provider, apiKey);
              setProviders((current) => upsertProvider(current, saved));
              setSelectedProviderId(saved.id);
              return `Saved provider ${saved.id}`;
            });
          }}
          onDeleteProvider={async (providerId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Deleting provider ${providerId}...`, async () => {
              await api.deleteProvider(providerId);
              setProviders((current) => current.filter((provider) => provider.id !== providerId));
              setSelectedProviderId((current) => current === providerId ? undefined : current);
              return `Deleted provider ${providerId}`;
            });
          }}
          onTestProvider={async (provider, apiKey) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Testing provider ${provider.id}...`, async () => {
              const saved = await api.saveProvider(provider, apiKey);
              setProviders((current) => upsertProvider(current, saved));
              setSelectedProviderId(saved.id);
              await api.testProvider(saved.id, saved.models.review ?? saved.models.default);
              return `Provider test succeeded: ${saved.id}`;
            });
          }}
        />
        <TemplatesPage
          templates={templates}
          onSave={async (template) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Saving template ${template.id}...`, async () => {
              const saved = await api.savePromptTemplate(template);
              setTemplates((current) =>
                current.map((item) => (item.id === saved.id ? saved : item))
              );
              return `Saved template ${saved.id}`;
            });
          }}
          onDelete={async (templateId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Deleting template ${templateId}...`, async () => {
              await api.deletePromptTemplate(templateId);
              setTemplates((current) => current.filter((template) => template.id !== templateId));
              return `Deleted template ${templateId}`;
            });
          }}
        />
        <RunsPage
          runs={runs}
          selectedOutput={selectedOutput?.kind === "run" ? selectedOutput.content : undefined}
          selectedOutputRunId={selectedOutput?.kind === "run" ? selectedOutput.id : undefined}
          selectedStatus={selectedRunStatus?.content}
          selectedStatusRunId={selectedRunStatus?.id}
          onCancel={async (runId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Cancelling run ${runId}...`, async () => {
              await api.cancelAutomationRun(runId);
              await refreshRuns(api, setRuns, setRuntimeError);
              return `Cancelled run ${runId}`;
            });
          }}
          onShowStatus={async (run) => {
            if (!api) {
              return;
            }
            if (selectedRunStatus?.id === run.id) {
              setSelectedRunStatus(undefined);
              setStatusMessage(`Collapsed run ${run.id} decision summary`);
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Loading Codex decision summary for ${run.id}...`, async () => {
              const output = await api.readAutomationRunOutput(run.id);
              const content = formatRunDecisionSummary(run, formatOutput(output));
              setSelectedRunStatus({ id: run.id, content });
              return `Loaded Codex decision summary for ${run.id}`;
            });
          }}
          onReadOutput={async (runId) => {
            if (!api) {
              return;
            }
            if (selectedOutput?.kind === "run" && selectedOutput.id === runId) {
              setSelectedOutput(undefined);
              setStatusMessage(`Collapsed run ${runId} output`);
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Reading run ${runId} output...`, async () => {
              const output = await api.readAutomationRunOutput(runId);
              setSelectedOutput({ kind: "run", id: runId, content: formatOutput(output) });
              return `Loaded run ${runId} output`;
            });
          }}
          onDelete={async (runId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Deleting run ${runId}...`, async () => {
              await api.deleteAutomationRun(runId);
              setRuns((current) => current.filter((run) => run.id !== runId));
              if (selectedOutput?.kind === "run" && selectedOutput.id === runId) {
                setSelectedOutput(undefined);
              }
              if (selectedRunStatus?.id === runId) {
                setSelectedRunStatus(undefined);
              }
              return `Deleted run ${runId}`;
            });
          }}
        />
        <TasksPage
          tasks={tasks}
          selectedOutput={selectedOutput?.kind === "task" ? selectedOutput.content : undefined}
          selectedOutputTaskId={selectedOutput?.kind === "task" ? selectedOutput.id : undefined}
          onCancelTask={async (taskId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Cancelling task ${taskId}...`, async () => {
              await api.cancelTask(taskId);
              await refreshTasks(api, setTasks, setRuntimeError);
              return `Cancelled task ${taskId}`;
            });
          }}
          onReadTaskOutput={async (taskId) => {
            if (!api) {
              return;
            }
            if (selectedOutput?.kind === "task" && selectedOutput.id === taskId) {
              setSelectedOutput(undefined);
              setStatusMessage(`Collapsed task ${taskId} output`);
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, `Reading task ${taskId} output...`, async () => {
              const output = await api.readTaskOutput(taskId);
              setSelectedOutput({ kind: "task", id: taskId, content: formatOutput(output) });
              return `Loaded task ${taskId} output`;
            });
          }}
          onClearTasks={async () => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, "Clearing task history...", async () => {
              await api.clearTasks();
              setTasks([]);
              setSelectedOutput((current) => current?.kind === "task" ? undefined : current);
              return "Task history cleared";
            });
          }}
        />
        <section className="page-section" id="settings">
          <header>
            <h2>Settings</h2>
          </header>
          <form
            className="runtime-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!api) {
                return;
              }
              await runAction(setRuntimeError, setStatusMessage, "Saving runtime settings...", async () => {
                const response = await api.saveRuntimeSettings({
                  claudePath,
                  codexPath
                });
                setClaudePath(response.claudePath);
                setCodexPath(response.codexPath);
                setWorkspaceRoots(response.allowedRoots);
                return "Runtime settings saved";
              });
            }}
          >
            <label>
              <span>Claude Code CLI path</span>
              <input
                value={claudePath}
                onChange={(event) => setClaudePath(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Codex CLI path</span>
              <input
                value={codexPath}
                onChange={(event) => setCodexPath(event.currentTarget.value)}
              />
            </label>
            <button type="submit">Save runtime settings</button>
            <button
              type="button"
              onClick={async () => {
                if (!api) {
                  return;
                }
                await runAction(setRuntimeError, setStatusMessage, "Testing Codex CLI...", async () => {
                  const result = await api.testCodex();
                  return `Codex CLI ok: ${result.version || result.codexPath}`;
                });
              }}
            >
              Test Codex
            </button>
          </form>
        </section>
      </div>
      <footer className={`status-bar ${runtimeError ? "status-bar-error" : ""}`}>
        {runtimeError ? `${runtimeError.code}: ${runtimeError.message}` : statusMessage || "Ready"}
      </footer>
    </main>
  );
}

async function refreshProviders(
  api: GuiApi,
  setProviders: (providers: ProviderConfig[]) => void,
  setSelectedProviderId: (providerId: string | undefined) => void,
  setRuntimeError: (error: { code: string; message: string } | undefined) => void
): Promise<void> {
  try {
    const providers = await api.listProviders();
    setProviders(providers);
    setSelectedProviderId(providers[0]?.id);
    setRuntimeError(undefined);
  } catch (error) {
    setRuntimeError(toRuntimeError(error));
  }
}

async function refreshTasks(
  api: GuiApi,
  setTasks: (tasks: GuiTaskRecord[]) => void,
  setRuntimeError: (error: { code: string; message: string } | undefined) => void
): Promise<void> {
  try {
    setTasks(await api.listTasks());
    setRuntimeError(undefined);
  } catch (error) {
    setRuntimeError(toRuntimeError(error));
  }
}

async function refreshTemplates(
  api: GuiApi,
  setTemplates: (templates: PromptTemplate[]) => void,
  setRuntimeError: (error: { code: string; message: string } | undefined) => void
): Promise<void> {
  try {
    setTemplates(await api.listPromptTemplates());
    setRuntimeError(undefined);
  } catch (error) {
    setRuntimeError(toRuntimeError(error));
  }
}

async function refreshRuns(
  api: GuiApi,
  setRuns: (runs: AutomationRunRecord[]) => void,
  setRuntimeError: (error: { code: string; message: string } | undefined) => void
): Promise<void> {
  try {
    setRuns(await api.listAutomationRuns());
    setRuntimeError(undefined);
  } catch (error) {
    setRuntimeError(toRuntimeError(error));
  }
}

async function refreshRuntimeSettings(
  api: GuiApi,
  setClaudePath: (path: string) => void,
  setCodexPath: (path: string) => void,
  setWorkspaceRoots: (roots: string[]) => void,
  setRuntimeError: (error: { code: string; message: string } | undefined) => void
): Promise<void> {
  try {
    const settings = await api.getRuntimeSettings();
    setClaudePath(settings.claudePath);
    setCodexPath(settings.codexPath);
    setWorkspaceRoots(settings.allowedRoots);
    setRuntimeError(undefined);
  } catch (error) {
    setRuntimeError(toRuntimeError(error));
  }
}

async function runAction(
  setRuntimeError: (error: { code: string; message: string } | undefined) => void,
  setStatusMessage: (message: string) => void,
  pendingMessage: string,
  action: () => Promise<string>
): Promise<void> {
  setRuntimeError(undefined);
  setStatusMessage(pendingMessage);
  try {
    setStatusMessage(await action());
  } catch (error) {
    const runtimeError = toRuntimeError(error);
    setRuntimeError(runtimeError);
    setStatusMessage(runtimeError.message);
  }
}
