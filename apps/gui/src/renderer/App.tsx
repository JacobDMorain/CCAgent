import { useEffect, useMemo, useState } from "react";
import type { AutomationRunRecord, PromptTemplate, ProviderConfig, ReviewRole } from "@ccagent/core";
import { ProvidersPage } from "./routes/ProvidersPage.js";
import { ReviewRolesPage } from "./routes/ReviewRolesPage.js";
import { ReviewWorkspacePage } from "./routes/ReviewWorkspacePage.js";
import { RunsPage } from "./routes/RunsPage.js";
import { TemplatesPage } from "./routes/TemplatesPage.js";
import { TasksPage } from "./routes/TasksPage.js";
import {
  buildRunDecisionDetails,
  formatOutput,
  toRuntimeError,
  upsertProvider,
  type RunDecisionDetails
} from "./guiLogic.js";
import { createTranslator, normalizeLocale, type Locale } from "./i18n.js";
import type { GuiApi, GuiTaskRecord } from "./types.js";

export interface AppProps {
  initialProviders?: ProviderConfig[];
  initialReviewRoles?: ReviewRole[];
  initialTasks?: GuiTaskRecord[];
  initialRuns?: AutomationRunRecord[];
  initialTemplates?: PromptTemplate[];
  initialWorkspaceRoots?: string[];
  initialLocale?: Locale;
  daemonError?: { code: string; message: string };
}

export function App({
  initialProviders = [],
  initialReviewRoles = [],
  initialTasks = [],
  initialRuns = [],
  initialTemplates = [],
  initialWorkspaceRoots = [],
  initialLocale,
  daemonError
}: AppProps) {
  const api = typeof window === "undefined" ? undefined : window.ccagent;
  const [locale, setLocale] = useState<Locale>(() => {
    if (initialLocale) {
      return initialLocale;
    }
    if (typeof window === "undefined") {
      return "en";
    }
    return normalizeLocale(window.localStorage.getItem("ccagent.locale") ?? window.navigator.language);
  });
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [providers, setProviders] = useState(initialProviders);
  const [reviewRoles, setReviewRoles] = useState(initialReviewRoles);
  const [generatedRoles, setGeneratedRoles] = useState<ReviewRole[]>([]);
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
  const [selectedRunStatus, setSelectedRunStatus] = useState<{ id: string; content: RunDecisionDetails } | undefined>();

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ccagent.locale", locale);
    }
  }, [locale]);

  useEffect(() => {
    if (!api) {
      return;
    }

    void refreshProviders(api, setProviders, setSelectedProviderId, setRuntimeError);
    void refreshReviewRoles(api, setReviewRoles, setRuntimeError);
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
  const visibleTemplates = useMemo(
    () => templates.filter((template) => isTemplateVisibleForLocale(template.id, locale)),
    [templates, locale]
  );

  return (
    <main className="app-shell">
      <nav className="sidebar" aria-label="Primary">
        <h1>CCAgent</h1>
        <a href="#review-workspace">{t("navReviewWorkspace")}</a>
        <a href="#review-roles">{t("navReviewRoles")}</a>
        <a href="#providers">{t("navProviders")}</a>
        <a href="#templates">{t("navTemplates")}</a>
        <a href="#runs">{t("navRuns")}</a>
        <a href="#tasks">{t("navTasks")}</a>
        <a href="#settings">{t("navSettings")}</a>
        <label className="language-switch">
          <span>{t("language")}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(normalizeLocale(event.currentTarget.value))}
          >
            <option value="zh">{t("chinese")}</option>
            <option value="en">{t("english")}</option>
          </select>
        </label>
      </nav>
      <div className="workspace">
        <ReviewWorkspacePage
          locale={locale}
          t={t}
          providers={providers}
          templates={visibleTemplates}
          globalRoles={reviewRoles}
          generatedRoles={generatedRoles}
          onGenerateRoles={async (request) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("generatingReviewRoles"), async () => {
              const result = await api.generateReviewRoles(request);
              setGeneratedRoles(result.roles);
              return t("generatedReviewRoles", { count: result.roles.length });
            });
          }}
          onPromoteGeneratedRole={async (role) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("promotingReviewRole", { id: role.id }), async () => {
              const saved = await api.promoteReviewRole(role);
              setReviewRoles((current) => upsertRole(current, saved));
              setGeneratedRoles((current) => current.filter((item) => item.id !== role.id));
              return t("promotedReviewRole", { id: saved.id });
            });
          }}
          onStart={async (request) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("startingAutomationRun"), async () => {
              const nextRoots = Array.from(new Set([...workspaceRoots, request.cwd]));
              if (nextRoots.length !== workspaceRoots.length) {
                const settings = await api.setWorkspaceRoots(nextRoots);
                setWorkspaceRoots(settings.allowedRoots);
              }
              const run = await api.createAutomationRun(request);
              setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
              return t("startedAutomationRun", { id: run.id });
            });
          }}
        />
        <ReviewRolesPage
          locale={locale}
          t={t}
          roles={reviewRoles}
          onSave={async (role) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("savingReviewRole", { id: role.id }), async () => {
              const saved = await api.saveReviewRole(role);
              setReviewRoles((current) => upsertRole(current, saved));
              return t("savedReviewRole", { id: saved.id });
            });
          }}
          onDelete={async (roleId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("deletingReviewRole", { id: roleId }), async () => {
              await api.deleteReviewRole(roleId);
              setReviewRoles((current) => current.filter((role) => role.id !== roleId));
              return t("deletedReviewRole", { id: roleId });
            });
          }}
        />
        <ProvidersPage
          t={t}
          providers={providers}
          selectedProviderId={selectedProvider?.id}
          onSelectProvider={setSelectedProviderId}
          onSaveProvider={async (provider, apiKey) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("savingProvider", { id: provider.id }), async () => {
              const saved = await api.saveProvider(provider, apiKey);
              setProviders((current) => upsertProvider(current, saved));
              setSelectedProviderId(saved.id);
              return t("savedProvider", { id: saved.id });
            });
          }}
          onDeleteProvider={async (providerId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("deletingProvider", { id: providerId }), async () => {
              await api.deleteProvider(providerId);
              setProviders((current) => current.filter((provider) => provider.id !== providerId));
              setSelectedProviderId((current) => current === providerId ? undefined : current);
              return t("deletedProvider", { id: providerId });
            });
          }}
          onTestProvider={async (provider, apiKey) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("testingProvider", { id: provider.id }), async () => {
              const saved = await api.saveProvider(provider, apiKey);
              setProviders((current) => upsertProvider(current, saved));
              setSelectedProviderId(saved.id);
              await api.testProvider(saved.id, saved.models.review ?? saved.models.default);
              return t("providerTestSucceeded", { id: saved.id });
            });
          }}
        />
        <TemplatesPage
          t={t}
          templates={visibleTemplates}
          onSave={async (template) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("savingTemplate", { id: template.id }), async () => {
              const saved = await api.savePromptTemplate(template);
              setTemplates((current) =>
                current.map((item) => (item.id === saved.id ? saved : item))
              );
              return t("savedTemplate", { id: saved.id });
            });
          }}
          onDelete={async (templateId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("deletingTemplate", { id: templateId }), async () => {
              await api.deletePromptTemplate(templateId);
              setTemplates((current) => current.filter((template) => template.id !== templateId));
              return t("deletedTemplate", { id: templateId });
            });
          }}
        />
        <RunsPage
          t={t}
          runs={runs}
          selectedOutput={selectedOutput?.kind === "run" ? selectedOutput.content : undefined}
          selectedOutputRunId={selectedOutput?.kind === "run" ? selectedOutput.id : undefined}
          selectedStatus={selectedRunStatus?.content}
          selectedStatusRunId={selectedRunStatus?.id}
          onCancel={async (runId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("cancellingRun", { id: runId }), async () => {
              await api.cancelAutomationRun(runId);
              await refreshRuns(api, setRuns, setRuntimeError);
              return t("cancelledRun", { id: runId });
            });
          }}
          onShowStatus={async (run) => {
            if (!api) {
              return;
            }
            if (selectedRunStatus?.id === run.id) {
              setSelectedRunStatus(undefined);
              setStatusMessage(t("collapsedRunDecisionSummary", { id: run.id }));
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("loadingRunDecisionSummary", { id: run.id }), async () => {
              const output = await api.readAutomationRunOutput(run.id);
              const content = buildRunDecisionDetails(run, formatOutput(output), locale);
              setSelectedRunStatus({ id: run.id, content });
              return t("loadedRunDecisionSummary", { id: run.id });
            });
          }}
          onSelectStatusIteration={(runId, iteration) => {
            setSelectedRunStatus((current) => {
              if (!current || current.id !== runId) {
                return current;
              }
              return {
                ...current,
                content: {
                  ...current.content,
                  selectedIteration: iteration
                }
              };
            });
          }}
          onReadOutput={async (runId) => {
            if (!api) {
              return;
            }
            if (selectedOutput?.kind === "run" && selectedOutput.id === runId) {
              setSelectedOutput(undefined);
              setStatusMessage(t("collapsedRunOutput", { id: runId }));
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("readingRunOutput", { id: runId }), async () => {
              const output = await api.readAutomationRunOutput(runId);
              setSelectedOutput({ kind: "run", id: runId, content: formatOutput(output) });
              return t("loadedRunOutput", { id: runId });
            });
          }}
          onDelete={async (runId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("deletingRun", { id: runId }), async () => {
              await api.deleteAutomationRun(runId);
              setRuns((current) => current.filter((run) => run.id !== runId));
              if (selectedOutput?.kind === "run" && selectedOutput.id === runId) {
                setSelectedOutput(undefined);
              }
              if (selectedRunStatus?.id === runId) {
                setSelectedRunStatus(undefined);
              }
              return t("deletedRun", { id: runId });
            });
          }}
        />
        <TasksPage
          t={t}
          tasks={tasks}
          selectedOutput={selectedOutput?.kind === "task" ? selectedOutput.content : undefined}
          selectedOutputTaskId={selectedOutput?.kind === "task" ? selectedOutput.id : undefined}
          onCancelTask={async (taskId) => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("cancellingTask", { id: taskId }), async () => {
              await api.cancelTask(taskId);
              await refreshTasks(api, setTasks, setRuntimeError);
              return t("cancelledTask", { id: taskId });
            });
          }}
          onReadTaskOutput={async (taskId) => {
            if (!api) {
              return;
            }
            if (selectedOutput?.kind === "task" && selectedOutput.id === taskId) {
              setSelectedOutput(undefined);
              setStatusMessage(t("collapsedTaskOutput", { id: taskId }));
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("readingTaskOutput", { id: taskId }), async () => {
              const output = await api.readTaskOutput(taskId);
              setSelectedOutput({ kind: "task", id: taskId, content: formatOutput(output) });
              return t("loadedTaskOutput", { id: taskId });
            });
          }}
          onClearTasks={async () => {
            if (!api) {
              return;
            }
            await runAction(setRuntimeError, setStatusMessage, t("clearingTaskHistory"), async () => {
              await api.clearTasks();
              setTasks([]);
              setSelectedOutput((current) => current?.kind === "task" ? undefined : current);
              return t("taskHistoryCleared");
            });
          }}
        />
        <section className="page-section" id="settings">
          <header>
            <h2>{t("settingsTitle")}</h2>
          </header>
          <form
            className="runtime-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!api) {
                return;
              }
              await runAction(setRuntimeError, setStatusMessage, t("savingRuntimeSettings"), async () => {
                const response = await api.saveRuntimeSettings({
                  claudePath,
                  codexPath
                });
                setClaudePath(response.claudePath);
                setCodexPath(response.codexPath);
                setWorkspaceRoots(response.allowedRoots);
                return t("runtimeSettingsSaved");
              });
            }}
          >
            <label>
              <span>{t("claudeCodeCliPath")}</span>
              <input
                value={claudePath}
                onChange={(event) => setClaudePath(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>{t("codexCliPath")}</span>
              <input
                value={codexPath}
                onChange={(event) => setCodexPath(event.currentTarget.value)}
              />
            </label>
            <button type="submit">{t("saveRuntimeSettings")}</button>
            <button
              type="button"
              onClick={async () => {
                if (!api) {
                  return;
                }
                await runAction(setRuntimeError, setStatusMessage, t("testingCodexCli"), async () => {
                  const result = await api.testCodex();
                  return t("codexCliOk", { value: result.version || result.codexPath });
                });
              }}
            >
              {t("testCodex")}
            </button>
          </form>
        </section>
      </div>
      <footer className={`status-bar ${runtimeError ? "status-bar-error" : ""}`}>
        {runtimeError ? `${runtimeError.code}: ${runtimeError.message}` : statusMessage || t("ready")}
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

async function refreshReviewRoles(
  api: GuiApi,
  setReviewRoles: (roles: ReviewRole[]) => void,
  setRuntimeError: (error: { code: string; message: string } | undefined) => void
): Promise<void> {
  try {
    setReviewRoles(await api.listReviewRoles());
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

function isTemplateVisibleForLocale(templateId: string, locale: Locale): boolean {
  return locale === "zh" ? templateId.endsWith("-zh") : !templateId.endsWith("-zh");
}

function upsertRole(roles: ReviewRole[], next: ReviewRole): ReviewRole[] {
  const existing = roles.findIndex((role) => role.id === next.id);
  if (existing === -1) {
    return [...roles, next];
  }
  return roles.map((role) => role.id === next.id ? next : role);
}
