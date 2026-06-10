import type { AutomationRunRequest, PromptTemplate, ProviderConfig, ReviewRole } from "@ccagent/core";
import type { Locale, Translator } from "../i18n.js";

export interface ReviewWorkspacePageProps {
  locale: Locale;
  t: Translator;
  providers: ProviderConfig[];
  templates: PromptTemplate[];
  globalRoles?: ReviewRole[];
  generatedRoles?: ReviewRole[];
  onGenerateRoles?(request: { cwd: string; file: string; language?: string }): void | Promise<void>;
  onPromoteGeneratedRole?(role: ReviewRole): void | Promise<void>;
  onStart(request: AutomationRunRequest): void | Promise<void>;
}

export function ReviewWorkspacePage({
  locale,
  t,
  providers,
  templates,
  globalRoles = [],
  generatedRoles = [],
  onGenerateRoles,
  onPromoteGeneratedRole,
  onStart
}: ReviewWorkspacePageProps) {
  const claudeTemplates = templates.filter((template) => template.kind === "claude-review");
  const codexTemplates = templates.filter((template) => template.kind === "codex-edit");
  const defaultClaudeTemplateId = preferredTemplateId(claudeTemplates, locale, "default-claude-review-full");
  const defaultCodexTemplateId = preferredTemplateId(codexTemplates, locale, "default-codex-edit");
  const roles = [...globalRoles, ...generatedRoles];

  return (
    <section className="page-section" id="review-workspace">
      <header className="section-header">
        <div>
          <h2>{t("reviewWorkspaceTitle")}</h2>
          <p>{t("reviewWorkspaceDescription")}</p>
        </div>
      </header>
      <form
        className="run-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void onStart(buildReviewWorkspaceRequestFromForm(form, { providers, roles }));
        }}
      >
        <div className="form-grid">
          <label>
            <span>{t("workspaceRoot")}</span>
            <input name="cwd" placeholder="D:/project" required />
          </label>
          <label>
            <span>{t("targetFile")}</span>
            <input name="file" placeholder="docs/handoff.md" required />
          </label>
          <label>
            <span>{t("claudeReviewTemplate")}</span>
            <select name="claudeTemplateId" required defaultValue={defaultClaudeTemplateId}>
              {claudeTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("codexEditTemplate")}</span>
            <select name="codexTemplateId" required defaultValue={defaultCodexTemplateId}>
              {codexTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("reviewStyle")}</span>
            <select name="reviewStyle" defaultValue="full">
              <option value="full">{t("reviewStyleFull")}</option>
              <option value="bugs">{t("reviewStyleBugs")}</option>
              <option value="architecture">{t("reviewStyleArchitecture")}</option>
              <option value="language">{t("reviewStyleLanguage")}</option>
            </select>
          </label>
          <label>
            <span>{t("language")}</span>
            <input name="language" placeholder={locale === "zh" ? "中文" : "English"} defaultValue={locale === "zh" ? "Chinese" : "English"} />
          </label>
          <label>
            <span>{t("maxIterations")}</span>
            <input name="maxIterations" type="number" min="1" max="10" defaultValue="3" />
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
        <div className="role-section">
          <div className="section-header compact-header">
            <h3>{t("globalRoles")}</h3>
          </div>
          <div className="provider-checks">
            {globalRoles.map((role) => (
              <RoleCheckRow key={role.id} role={role} defaultChecked={role.defaultSelected} />
            ))}
          </div>
          <div className="section-header compact-header">
            <h3>{t("generatedRoles")}</h3>
            {onGenerateRoles ? (
              <button
                type="button"
                onClick={() => {
                  const element = document.querySelector("#review-workspace form");
                  if (!(element instanceof HTMLFormElement)) {
                    return;
                  }
                  const form = new FormData(element);
                  void onGenerateRoles({
                    cwd: stringField(form, "cwd"),
                    file: stringField(form, "file"),
                    language: optionalStringField(form, "language")
                  });
                }}
              >
                {t("generateRolesFromDocument")}
              </button>
            ) : (
              <span>{t("generateRolesFromDocument")}</span>
            )}
          </div>
          <div className="provider-checks">
            {generatedRoles.map((role) => (
              <div className="check-row role-row" key={role.id}>
                <RoleCheckRow role={role} defaultChecked={role.defaultSelected} />
                {onPromoteGeneratedRole ? (
                  <button type="button" onClick={() => void onPromoteGeneratedRole(role)}>
                    {t("promoteRole")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="button-row">
          <button type="submit">{t("startFullyAutomaticRun")}</button>
        </div>
      </form>
    </section>
  );
}

function RoleCheckRow({ role, defaultChecked }: { role: ReviewRole; defaultChecked: boolean }) {
  return (
    <label className="check-row" title={role.description}>
      <input
        type="checkbox"
        name={`role:${role.id}`}
        defaultChecked={defaultChecked}
      />
      <span>{role.name}</span>
    </label>
  );
}

function preferredTemplateId(templates: PromptTemplate[], locale: Locale, fallbackId: string): string | undefined {
  const localizedId = locale === "zh" ? `${fallbackId}-zh` : fallbackId;
  return templates.find((template) => template.id === localizedId)?.id ?? templates[0]?.id;
}

function stringField(form: FormLike, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalStringField(form: FormLike, name: string): string | undefined {
  const value = stringField(form, name);
  return value || undefined;
}

function numberField(form: FormLike, name: string, fallback: number): number {
  const value = Number(stringField(form, name));
  return Number.isFinite(value) ? value : fallback;
}

interface FormLike {
  get(name: string): FormDataEntryValue | undefined | null;
  has(name: string): boolean;
}

export function buildReviewWorkspaceRequestFromForm(
  form: FormLike,
  input: { providers: ProviderConfig[]; roles: ReviewRole[] }
): AutomationRunRequest {
  const selectedRoles = input.roles.filter((role) => form.has(`role:${role.id}`));
  const roleIds = selectedRoles.map((role) => role.id);
  const selectedProviders = input.providers
    .filter((provider) => form.has(`provider:${provider.id}`))
    .map((provider) => ({ provider: provider.id, roleIds }));
  return {
    cwd: stringField(form, "cwd"),
    file: stringField(form, "file"),
    reviewers: selectedProviders,
    roles: input.roles,
    claudeTemplateId: stringField(form, "claudeTemplateId"),
    codexTemplateId: stringField(form, "codexTemplateId"),
    reviewStyle: stringField(form, "reviewStyle") as AutomationRunRequest["reviewStyle"],
    language: optionalStringField(form, "language"),
    fullyAuto: true,
    maxIterations: numberField(form, "maxIterations", 3)
  };
}

export namespace ReviewWorkspacePage {
  export const buildRequestFromForm = buildReviewWorkspaceRequestFromForm;
}
