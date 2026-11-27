import { neon } from "@neondatabase/serverless";

export function databaseUrl(): string | null {
  const raw = process.env.DATABASE_URL?.trim();
  return raw || null;
}

type Sql = ReturnType<typeof neon>;

const globalRef = globalThis as typeof globalThis & {
  __cardcropSql?: Sql;
  __cardcropSchema?: Promise<void>;
};

export function getSql(): Sql {
  const url = databaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!globalRef.__cardcropSql) {
    globalRef.__cardcropSql = neon(url);
  }
  return globalRef.__cardcropSql;
}

export async function ensureSchema(): Promise<void> {
  if (!globalRef.__cardcropSchema) {
    const sql = getSql();
    globalRef.__cardcropSchema = (async () => {
      await sql`
        create table if not exists cards (
          id text primary key,
          owner_id text,
          filename text not null,
          player text,
          set_name text,
          manufacturer text,
          year integer,
          number text,
          parallel text,
          side text,
          workspace text,
          width integer,
          height integer,
          output_width integer,
          output_height integer,
          blob_url text,
          status text not null default 'completed',
          metadata jsonb,
          created_at timestamptz not null default now()
        )
      `;
      await sql`create index if not exists cards_created_at_idx on cards (created_at desc)`;
      await sql`
        create table if not exists batches (
          id text primary key,
          owner_id text,
          file_count integer not null,
          status text not null,
          metadata jsonb,
          created_at timestamptz not null default now()
        )
      `;
      await sql`
        create table if not exists audit_logs (
          id bigserial primary key,
          action text not null,
          entity_type text,
          entity_id text,
          metadata jsonb,
          created_at timestamptz not null default now()
        )
      `;
    })().catch((error) => {
      globalRef.__cardcropSchema = undefined;
      throw error;
    });
  }
  await globalRef.__cardcropSchema;
}

export async function writeAudit(
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown,
): Promise<void> {
  if (!databaseUrl()) return;
  const sql = getSql();
  await ensureSchema();
  await sql`
    insert into audit_logs (action, entity_type, entity_id, metadata)
    values (${action}, ${entityType}, ${entityId}, ${JSON.stringify(metadata)}::jsonb)
  `;
}
