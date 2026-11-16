import { createServerFn } from "@tanstack/react-start";
import { csrfMiddleware } from "@/lib/auth/csrf-middleware";
import { getSql } from "@/lib/db";

export type StoredCard = {
  id: string;
  sourceId: string;
  filename: string;
  player: string | null;
  setName: string | null;
  manufacturer: string | null;
  year: number | null;
  number: string | null;
  parallel: string | null;
  side: string | null;
  engine: string | null;
  detector: string | null;
  status: string;
  createdAt: string | null;
};

export type PersistInput = {
  id: string;
  sourceId: string;
  filename: string;
  player: string | null;
  setName: string | null;
  manufacturer: string | null;
  year: number | null;
  number: string | null;
  parallel: string | null;
  side: string | null;
  engine: string | null;
  detector: string | null;
  status: string;
};

export type CardPatch = {
  id: string;
  player: string | null;
  setName: string | null;
  manufacturer: string | null;
  year: number | null;
  number: string | null;
  parallel: string | null;
  side: string | null;
};

export type AuditRow = {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  filename: string | null;
  player: string | null;
  createdAt: string | null;
};

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
  created_at: string | null;
};

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
    createdAt: row.created_at,
  };
}

const CARD_SELECT = `
  id, source_id, filename, player, set_name, manufacturer, year,
  number, parallel, side, engine, detector, status, created_at
`;

export const saveProcessedCard = createServerFn({ method: "POST" })
  .middleware([csrfMiddleware])
  .validator((input: PersistInput) => input)
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`
      insert into cards (
        id, source_id, filename, player, set_name, manufacturer, year,
        number, parallel, side, engine, detector, status
      ) values (
        ${data.id}, ${data.sourceId}, ${data.filename}, ${data.player},
        ${data.setName}, ${data.manufacturer}, ${data.year}, ${data.number},
        ${data.parallel}, ${data.side}, ${data.engine}, ${data.detector}, ${data.status}
      )
      on conflict (id) do update set
        player = excluded.player,
        set_name = excluded.set_name,
        manufacturer = excluded.manufacturer,
        year = excluded.year,
        number = excluded.number,
        parallel = excluded.parallel,
        side = excluded.side,
        engine = excluded.engine,
        detector = excluded.detector,
        status = excluded.status
    `;
    await sql`
      insert into audit_logs (action, entity_type, entity_id, metadata)
      values (
        ${"card.processed"},
        ${"card"},
        ${data.id},
        ${JSON.stringify({
          filename: data.filename,
          player: data.player,
          set: data.setName,
          engine: data.engine,
          detector: data.detector,
        })}::jsonb
      )
    `;
    return { ok: true as const, id: data.id };
  });

export const listStoredCards = createServerFn({ method: "GET" })
  .middleware([csrfMiddleware])
  .handler(async () => {
  const sql = await getSql();
  const rows = await sql.query<CardRow>(
    `select ${CARD_SELECT} from cards order by created_at desc limit 100`,
  );
  return rows.map(mapCard);
});

export const getStoredCard = createServerFn({ method: "GET" })
  .middleware([csrfMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql.query<CardRow>(`select ${CARD_SELECT} from cards where id = $1`, [data.id]);
    return rows[0] ? mapCard(rows[0]) : null;
  });

export const updateStoredCard = createServerFn({ method: "POST" })
  .middleware([csrfMiddleware])
  .validator((input: CardPatch) => input)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql.query<CardRow>(
      `update cards set
        player = $2,
        set_name = $3,
        manufacturer = $4,
        year = $5,
        number = $6,
        parallel = $7,
        side = $8
      where id = $1
      returning ${CARD_SELECT}`,
      [
        data.id,
        data.player,
        data.setName,
        data.manufacturer,
        data.year,
        data.number,
        data.parallel,
        data.side,
      ],
    );
    const card = rows[0] ? mapCard(rows[0]) : null;
    if (!card) return { ok: false as const, error: "Card not found" };
    await sql`
      insert into audit_logs (action, entity_type, entity_id, metadata)
      values (
        ${"card.updated"},
        ${"card"},
        ${data.id},
        ${JSON.stringify({
          filename: card.filename,
          player: card.player,
          set: card.setName,
        })}::jsonb
      )
    `;
    return { ok: true as const, card };
  });

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([csrfMiddleware])
  .handler(async () => {
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    metadata: { filename?: string; player?: string } | string | null;
    created_at: string | null;
  }>`
    select id, action, entity_type, entity_id, metadata, created_at
    from audit_logs
    order by created_at desc
    limit 100
  `;
  return rows.map((row) => {
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
      createdAt: row.created_at,
    } satisfies AuditRow;
  });
});
