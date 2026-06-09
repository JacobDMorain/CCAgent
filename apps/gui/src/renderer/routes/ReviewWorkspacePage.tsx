import type { AutomationRunRequest, PromptTemplate, ProviderConfig } from "@ccagent/core";

export interface ReviewWorkspacePageProps {
  providers: ProviderConfig[];
  templates: PromptTemplate[];
  onStart(request: AutomationRunRequest): void | Promise<void>;
}

export function ReviewWorkspacePage({ providers, templates, onStart }: ReviewWorkspacePageProps) {
  const claudeTemplates = templates.filter((template) => template.kind === "claude-review");
  const codexTemplates = templates.filter((template) => template.kind === "codex-edit");

  return (
    <section className="page-section" id="review-workspace">
      <header className="section-header">
        <div>
          <h2>Review Workspace</h2>
          <p>Configure the target file, reviewers, templates, and start fully automatic review/edit.</p>
        </div>
      </header>
      <form
        className="run-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const selectedProviders = providers
            .filter((provider) => form.has(`provider:${provider.id}`))
            .map((provider) => ({ provider: provider.id }));
          void onStart({
            cwd: stringField(form, "cwd"),
            file: stringField(form, "file"),
            reviewers: selectedProviders,
            claudeTemplateId: stringField(form, "claudeTemplateId"),
            codexTemplateId: stringField(form, "codexTemplateId"),
            reviewStyle: stringField(form, "reviewStyle") as AutomationRunRequest["reviewStyle"],
            language: optionalStringField(form, "language"),
            fullyAuto: true
          });
        }}
      >
        <div className="form-grid">
          <label>
            <span>Workspace root</span>
            <input name="cwd" placeholder="D:/project" required />
          </label>
          <label>
            <span>Target file</span>
            <input name="file" placeholder="docs/handoff.md" required />
          </label>
          <label>
            <span>Claude review template</span>
            <select name="claudeTemplateId" required>
              {claudeTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Codex edit template</span>
            <select name="codexTemplateId" required>
              {codexTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Review style</span>
            <select name="reviewStyle" defaultValue="full">
              <option value="full">Full</option>
              <option value="bugs">Bugs</option>
              <option value="architecture">Architecture</option>
              <option value="language">Language</option>
            </select>
          </label>
          <label>
            <span>Language</span>
            <input name="language" placeholder="Chinese" />
          </label>
        </div>
        <div className="provider-checks">
          {providers.map((provider) => (
            <label className="check-row" key={provider.id}>
              <input
                type="checkbox"
                name={`provider:${provider.id}`}
                defaultChecked={provider.enabled}
              />
              <span>{provider.displayName} ({provider.id})</span>
            </label>
          ))}
        </div>
        <div className="button-row">
          <button type="submit">Start fully automatic run</button>
        </div>
      </form>
    </section>
  );
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalStringField(form: FormData, name: string): string | undefined {
  const value = stringField(form, name);
  return value || undefined;
}
