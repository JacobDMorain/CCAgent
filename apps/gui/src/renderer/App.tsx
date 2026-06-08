import { useEffect, useMemo, useState } from "react";
import type { ProviderConfig } from "@ccagent/core";
import { ProvidersPage } from "./routes/ProvidersPage.js";
import { TasksPage } from "./routes/TasksPage.js";
import { formatOutput, toRuntimeError, upsertProvider } from "./guiLogic.js";
import type { GuiApi, GuiTaskRecord } from "./types.js";

export interface AppProps {
  initialProviders?: ProviderConfig[];
  initialTasks?: GuiTaskRecord[];
  initialWorkspaceRoots?: string[];
  daemonError?: { code: string; message: string };
}

export function App({
  initialProviders = [],
  initialTasks = [],
  initialWorkspaceRoots = [],
  daemonError
}: AppProps) {
  const api = typeof window === "undefined" ? undefined : window.ccagent;
  const [providers, setProviders] = useState(initialProviders);
  const [tasks, setTasks] = useState(initialTasks);
  const [workspaceRoots, setWorkspaceRoots] = useState(initialWorkspaceRoots);
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(
    initialProviders[0]?.id
  );
  const [rootInput, setRootInput] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [runtimeError, setRuntimeError] = useState(daemonError);
  const [selectedOutput, setSelectedOutput] = useState("");

  useEffect(() => {
    if (!api) {
      return;
    }

    void refreshProviders(api, setProviders, setSelectedProviderId, setRuntimeError);
    void refreshTasks(api, setTasks, setRuntimeError);

    const timer = window.setInterval(() => {
      void refreshTasks(api, setTasks, setRuntimeError);
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
        <a href="#providers">Providers</a>
        <a href="#tasks">Tasks</a>
        <a href="#settings">Settings</a>
      </nav>
      <div className="workspace">
        {runtimeError ? (
          <section className="error-banner">
            <strong>{runtimeError.code}</strong>
            <span>{runtimeError.message}</span>
          </section>
        ) : null}
        {statusMessage ? <section className="status-banner">{statusMessage}</section> : null}
        <ProvidersPage
          providers={providers}
          selectedProviderId={selectedProvider?.id}
          onSelectProvider={setSelectedProviderId}
          onSaveProvider={async (provider, apiKey) => {
            if (!api) {
              return;
            }
            const saved = await api.saveProvider(provider, apiKey);
            setProviders((current) => upsertProvider(current, saved));
            setSelectedProviderId(saved.id);
            setStatusMessage(`Saved provider ${saved.id}`);
          }}
          onTestProvider={async (provider, model) => {
            if (!api) {
              return;
            }
            await api.testProvider(provider, model);
            setStatusMessage(`Provider test succeeded: ${provider}`);
          }}
        />
        <TasksPage
          tasks={tasks}
          selectedOutput={selectedOutput}
          onCancelTask={async (taskId) => {
            if (!api) {
              return;
            }
            await api.cancelTask(taskId);
            await refreshTasks(api, setTasks, setRuntimeError);
          }}
          onReadTaskOutput={async (taskId) => {
            if (!api) {
              return;
            }
            const output = await api.readTaskOutput(taskId);
            setSelectedOutput(formatOutput(output));
          }}
        />
        <section className="page-section" id="settings">
          <header>
            <h2>Workspace roots</h2>
          </header>
          <div className="roots-list">
            {workspaceRoots.length === 0 ? (
              <p>No workspace roots configured</p>
            ) : (
              workspaceRoots.map((root) => <code key={root}>{root}</code>)
            )}
          </div>
          <form
            className="settings-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const nextRoot = rootInput.trim();
              if (!nextRoot || !api) {
                return;
              }
              const nextRoots = Array.from(new Set([...workspaceRoots, nextRoot]));
              const response = await api.setWorkspaceRoots(nextRoots);
              setWorkspaceRoots(response.allowedRoots);
              setRootInput("");
              setStatusMessage("Workspace roots saved");
            }}
          >
            <input
              aria-label="Workspace root"
              value={rootInput}
              onChange={(event) => setRootInput(event.currentTarget.value)}
              placeholder="D:/project"
            />
            <button type="submit">Add root</button>
            <button
              type="button"
              onClick={async () => {
                if (!api) {
                  return;
                }
                const nextRoots = workspaceRoots.filter((root) => root !== rootInput.trim());
                const response = await api.setWorkspaceRoots(nextRoots);
                setWorkspaceRoots(response.allowedRoots);
                setRootInput("");
                setStatusMessage("Workspace roots saved");
              }}
            >
              Remove root
            </button>
          </form>
        </section>
      </div>
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
