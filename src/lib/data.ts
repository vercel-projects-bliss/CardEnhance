import { neon } from "@neondatabase/serverless";
import { connection } from "next/server";
import type { AuditRow, LibrarySummary, StoredCard } from "@/lib/types";

type CardRow = {
  id: string;
  source_id: string;
  filename: string;
  player: string | null;
  set_name: string | null;
  manufacturer: string | null;
  year: number | null;
  number: string | null;
  parallel: string | null;
  side: string | null;
  engine: string | null;
  detector: string | null;
  status: string;
  created_at: string | Date | null;
};

type AuditDbRow = {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: { filename?: string; player?: string } | string | null;
  created_at: string | Date | null;
};

function sqlClient() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

function asStamp(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapCard(row: CardRow): StoredCard {
  return {
    id: row.id,
    sourceId: row.source_id,
    filename: row.filename,
    player: row.player,
    setName: row.set_name,
    manufacturer: row.manufacturer,
    year: row.year,
    number: row.number,
    parallel: row.parallel,
    side: row.side,
    engine: row.engine,
    detector: row.detector,
    status: row.status,
    createdAt: asStamp(row.created_at),
  };
}

function mapAudit(row: AuditDbRow): AuditRow {
  const meta =
    typeof row.metadata === "string"
      ? (JSON.parse(row.metadata) as { filename?: string; player?: string })
      : (row.metadata ?? {});

  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    filename: meta.filename ?? null,
    player: meta.player ?? null,
    createdAt: asStamp(row.created_at),
  };
}

export async function listStoredCards(): Promise<StoredCard[]> {
  await connection();

  try {
    const sql = sqlClient();
    if (!sql) return [];

    const rows = (await sql`
      select
        id, source_id, filename, player, set_name, manufacturer, year,
        number, parallel, side, engine, detector, status, created_at
      from cards
      order by created_at desc
    `) as CardRow[];

    return rows.map(mapCard);
  } catch {
    return [];
  }
}

export async function getStoredCard(id: string): Promise<StoredCard | null> {
  await connection();

  try {
    const sql = sqlClient();
    if (!sql) return null;

    const rows = (await sql`
      select
        id, source_id, filename, player, set_name, manufacturer, year,
        number, parallel, side, engine, detector, status, created_at
      from cards
      where id = ${id}
      limit 1
    `) as CardRow[];

    return rows[0] ? mapCard(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function listAuditLogs(): Promise<AuditRow[]> {
  await connection();

  try {
    const sql = sqlClient();
    if (!sql) return [];

    const rows = (await sql`
      select id, action, entity_type, entity_id, metadata, created_at
      from audit_logs
      order by created_at desc
    `) as AuditDbRow[];

    return rows.map(mapAudit);
  } catch {
    return [];
  }
}

export async function getLibrarySummary(): Promise<LibrarySummary> {
  const [cards, logs] = await Promise.all([listStoredCards(), listAuditLogs()]);

  return {
    cards,
    processed: cards.filter((card) => card.status === "completed").length,
    auditCount: logs.length,
  };
}

export async function getRowCounts(): Promise<{ cards: number; audit: number }> {
  await connection();

  try {
    const sql = sqlClient();
    if (!sql) return { cards: 0, audit: 0 };

    const [cardRows, auditRows] = await Promise.all([
      sql`select count(*)::int as count from cards`,
      sql`select count(*)::int as count from audit_logs`,
    ]);

    return {
      cards: Number((cardRows[0] as { count: number } | undefined)?.count ?? 0),
      audit: Number((auditRows[0] as { count: number } | undefined)?.count ?? 0),
    };
  } catch {
    return { cards: 0, audit: 0 };
  }
}
