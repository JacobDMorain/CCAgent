import { useEffect, useState, type FormEvent } from "react";
import type { ReviewRole } from "@ccagent/core";
import type { Locale, Translator } from "../i18n.js";
import { groupReviewRoles, reviewRoleGroupLabel } from "../reviewRoleGroups.js";

export interface ReviewRolesPageProps {
  locale?: Locale;
  t: Translator;
  roles: ReviewRole[];
  onSave(role: ReviewRole): void | Promise<void>;
  onDelete(roleId: string): void | Promise<void>;
}

const knownRoleGroups = [
  "core-technology",
  "documentation-quality",
  "product-delivery",
  "user-perspective",
  "risk-opposition",
  "business-operations",
  "custom"
];

export function ReviewRolesPage({ locale = "en", t, roles, onSave, onDelete }: ReviewRolesPageProps) {
  const [selectedId, setSelectedId] = useState<string>(() => roles[0]?.id ?? "new-review-role");
  const selected = roles.find((role) => role.id === selectedId) ?? createEmptyRole();
  const selectedKnownGroup = knownRoleGroups.includes(selected.group) ? selected.group : "custom";
  const customGroupValue = selectedKnownGroup === "custom" && selected.group !== "custom" ? selected.group : "";

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
          {groupReviewRoles(roles, locale).map((group) => (
            <div className="role-list-group" key={group.id}>
              <div className="role-list-group-header">
                <h4>{group.label}</h4>
                <span>{group.roles.length} {group.roles.length === 1 ? "role" : "roles"}</span>
              </div>
              {group.roles.map((role) => (
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
            </div>
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
          <div className="form-grid role-editor-grid">
            <label>
              <span>ID</span>
              <input name="id" defaultValue={selected.id} required />
            </label>
            <label>
              <span>{t("name")}</span>
              <input name="name" defaultValue={selected.name} required />
            </label>
            <label className="role-group-field">
              <span>{t("roleGroup")}</span>
              <div className="role-group-picker">
                {knownRoleGroups.map((group) => (
                  <label className="role-group-chip" key={group}>
                    <input
                      type="radio"
                      name="group"
                      value={group}
                      defaultChecked={selectedKnownGroup === group}
                    />
                    <span>{reviewRoleGroupLabel(group, locale)}</span>
                  </label>
                ))}
              </div>
            </label>
            <label>
              <span>{locale === "zh" ? "自定义分组" : "Custom group"}</span>
              <input name="customGroup" defaultValue={customGroupValue} placeholder="domain-specialist" />
            </label>
            <label>
              <span>{t("description")}</span>
              <input name="description" defaultValue={selected.description} required />
            </label>
            <label>
              <span>{t("focusAreas")}</span>
              <input name="focusAreas" defaultValue={selected.focusAreas.join(", ")} />
            </label>
            <label className="check-row role-default-check">
              <input name="defaultSelected" type="checkbox" defaultChecked={selected.defaultSelected} />
              <span>{t("defaultSelected")}</span>
            </label>
          </div>
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
    group: resolveGroup(form),
    name: stringField(form, "name"),
    description: stringField(form, "description"),
    focusAreas: stringField(form, "focusAreas").split(",").map((item) => item.trim()).filter(Boolean),
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
    group: "custom",
    name: "",
    description: "",
    focusAreas: [],
    defaultSelected: false,
    source: "global",
    createdAt: now,
    updatedAt: now
  };
}

function resolveGroup(form: FormData): string {
  const selectedGroup = stringField(form, "group") || "custom";
  const customGroup = stringField(form, "customGroup");
  return selectedGroup === "custom" && customGroup ? customGroup : selectedGroup;
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}
