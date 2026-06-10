import { useEffect, useState, type FormEvent } from "react";
import type { ReviewRole } from "@ccagent/core";
import type { Translator } from "../i18n.js";

export interface ReviewRolesPageProps {
  t: Translator;
  roles: ReviewRole[];
  onSave(role: ReviewRole): void | Promise<void>;
  onDelete(roleId: string): void | Promise<void>;
}

export function ReviewRolesPage({ t, roles, onSave, onDelete }: ReviewRolesPageProps) {
  const [selectedId, setSelectedId] = useState<string>(() => roles[0]?.id ?? "new-review-role");
  const selected = roles.find((role) => role.id === selectedId) ?? createEmptyRole();

  useEffect(() => {
    if (roles.length > 0 && !roles.some((role) => role.id === selectedId)) {
      setSelectedId(roles[0].id);
    }
  }, [roles, selectedId]);

  return (
    <section className="page-section" id="review-roles">
      <header className="section-header">
        <div>
          <h2>{t("reviewRolesTitle")}</h2>
          <p>{t("reviewRolesDescription")}</p>
        </div>
        <button type="button" onClick={() => setSelectedId("new-review-role")}>{t("newRole")}</button>
      </header>
      <div className="provider-layout">
        <aside className="provider-list">
          {roles.map((role) => (
            <button
              key={role.id}
              type="button"
              className={role.id === selected.id ? "selected" : ""}
              onClick={() => setSelectedId(role.id)}
            >
              <strong>{role.name}</strong>
              <span>{role.defaultSelected ? t("defaultSelected") : role.source}</span>
            </button>
          ))}
        </aside>
        <form
          key={selected.id}
          className="panel provider-form"
          aria-label={t("roleEditor")}
          onSubmit={(event) => {
            event.preventDefault();
            const next = roleFromForm(event, selected);
            setSelectedId(next.id);
            void onSave(next);
          }}
        >
          <div className="form-grid">
            <label>
              <span>ID</span>
              <input name="id" defaultValue={selected.id} required />
            </label>
            <label>
              <span>{t("name")}</span>
              <input name="name" defaultValue={selected.name} required />
            </label>
            <label>
              <span>{t("description")}</span>
              <input name="description" defaultValue={selected.description} required />
            </label>
            <label>
              <span>{t("focusAreas")}</span>
              <input name="focusAreas" defaultValue={selected.focusAreas.join(", ")} />
            </label>
            <label className="check-row">
              <input name="defaultSelected" type="checkbox" defaultChecked={selected.defaultSelected} />
              <span>{t("defaultSelected")}</span>
            </label>
          </div>
          <label>
            <span>{t("rolePrompt")}</span>
            <textarea name="prompt" defaultValue={selected.prompt} required />
          </label>
          <label>
            <span>{t("outputInstructions")}</span>
            <textarea name="outputInstructions" defaultValue={selected.outputInstructions} required />
          </label>
          <div className="button-row flush-row">
            <button type="submit">{t("save")}</button>
            <button type="button" onClick={() => void onDelete(selected.id)}>{t("delete")}</button>
          </div>
        </form>
      </div>
    </section>
  );
}

function roleFromForm(event: FormEvent<HTMLFormElement>, previous: ReviewRole): ReviewRole {
  const form = new FormData(event.currentTarget);
  const now = new Date().toISOString();
  return {
    id: stringField(form, "id"),
    name: stringField(form, "name"),
    description: stringField(form, "description"),
    prompt: stringField(form, "prompt"),
    focusAreas: stringField(form, "focusAreas").split(",").map((item) => item.trim()).filter(Boolean),
    outputInstructions: stringField(form, "outputInstructions"),
    defaultSelected: form.has("defaultSelected"),
    source: "global",
    createdAt: previous.createdAt || now,
    updatedAt: now
  };
}

function createEmptyRole(): ReviewRole {
  const now = new Date().toISOString();
  return {
    id: "new-review-role",
    name: "",
    description: "",
    prompt: "",
    focusAreas: [],
    outputInstructions: "请使用 `## Role: <role name>` 分段输出。",
    defaultSelected: false,
    source: "global",
    createdAt: now,
    updatedAt: now
  };
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}
