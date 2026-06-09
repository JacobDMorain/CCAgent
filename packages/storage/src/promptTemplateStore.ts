import type { PromptTemplate } from "@ccagent/core";
import type { StorageDatabase } from "./database.js";

export class SqlitePromptTemplateStore {
  constructor(private readonly database: StorageDatabase) {}

  saveTemplate(template: PromptTemplate): PromptTemplate {
    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare(
          `INSERT INTO prompt_templates
            (id, kind, name, description, version, content, required_variables_json, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            name = excluded.name,
            description = excluded.description,
            version = excluded.version,
            content = excluded.content,
            required_variables_json = excluded.required_variables_json,
            is_default = excluded.is_default,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at`
        )
        .run(
          template.id,
          template.kind,
          template.name,
          template.description,
          template.version,
          template.content,
          JSON.stringify(template.requiredVariables),
          template.isDefault ? 1 : 0,
          template.createdAt,
          template.updatedAt
        );
      return cloneTemplate(template);
    }

    this.database.promptTemplates.set(template.id, cloneTemplate(template));
    return cloneTemplate(template);
  }

  getTemplate(id: string): PromptTemplate | undefined {
    if (this.database.kind === "sqlite") {
      const row = this.database.handle
        .prepare("SELECT * FROM prompt_templates WHERE id = ?")
        .get(id) as SqlitePromptTemplateRow | undefined;
      return row ? sqliteRowToTemplate(row) : undefined;
    }

    const template = this.database.promptTemplates.get(id);
    return template ? cloneTemplate(template) : undefined;
  }

  listTemplates(): PromptTemplate[] {
    if (this.database.kind === "sqlite") {
      return this.database.handle
        .prepare("SELECT * FROM prompt_templates ORDER BY kind ASC, is_default DESC, name ASC")
        .all()
        .map((row) => sqliteRowToTemplate(row as SqlitePromptTemplateRow));
    }

    return [...this.database.promptTemplates.values()]
      .sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`))
      .map(cloneTemplate);
  }

  deleteTemplate(id: string): void {
    if (this.database.kind === "sqlite") {
      this.database.handle.prepare("DELETE FROM prompt_templates WHERE id = ?").run(id);
      return;
    }

    this.database.promptTemplates.delete(id);
  }
}

interface SqlitePromptTemplateRow {
  id: string;
  kind: PromptTemplate["kind"];
  name: string;
  description: string;
  version: number;
  content: string;
  required_variables_json: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

function sqliteRowToTemplate(row: SqlitePromptTemplateRow): PromptTemplate {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    version: row.version,
    content: row.content,
    requiredVariables: JSON.parse(row.required_variables_json) as string[],
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function cloneTemplate(template: PromptTemplate): PromptTemplate {
  return {
    ...template,
    requiredVariables: [...template.requiredVariables]
  };
}
