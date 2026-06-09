import type { PromptTemplate } from "@ccagent/core";
import { useMemo, useState } from "react";

export interface TemplatesPageProps {
  templates: PromptTemplate[];
  onSave(template: PromptTemplate): void | Promise<void>;
  onDelete?(templateId: string): void | Promise<void>;
}

export function TemplatesPage({ templates, onSave, onDelete }: TemplatesPageProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(templates[0]?.id);
  const current = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0],
    [selectedTemplateId, templates]
  );
  return (
    <section className="page-section" id="templates">
      <header>
        <h2>Prompt Templates</h2>
      </header>
      <div className="template-grid">
        <div className="template-list">
          {templates.map((template) => (
            <button
              type="button"
              key={template.id}
              className={`template-item ${template.id === current?.id ? "selected" : ""}`}
              onClick={() => setSelectedTemplateId(template.id)}
            >
              <strong>{template.name}</strong>
              <span>{template.kind} v{template.version}</span>
              <small>{template.requiredVariables.join(", ")}</small>
            </button>
          ))}
        </div>
        {current ? (
          <form
            key={current.id}
            className="template-editor"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void onSave({
                ...current,
                name: stringField(form, "name"),
                description: stringField(form, "description"),
                content: stringField(form, "content"),
                updatedAt: new Date().toISOString()
              });
            }}
          >
            <label>
              <span>Name</span>
              <input name="name" defaultValue={current.name} />
            </label>
            <label>
              <span>Description</span>
              <input name="description" defaultValue={current.description} />
            </label>
            <label>
              <span>Content</span>
              <textarea name="content" defaultValue={current.content} />
            </label>
            <div className="button-row flush-row">
              <button type="submit">Save template</button>
              {!current.isDefault ? (
                <button type="button" onClick={() => void onDelete?.(current.id)}>
                  Delete template
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <p>No templates loaded</p>
        )}
      </div>
    </section>
  );
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}
