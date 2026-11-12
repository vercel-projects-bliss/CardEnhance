import { neon } from "@neondatabase/serverless";
import { connection, NextResponse } from "next/server";

export async function GET() {
  await connection();

  let db = false;

  try {
    const url = process.env.DATABASE_URL;
    if (url) {
      const sql = neon(url);
      await sql`SELECT 1`;
      db = true;
    }
  } catch {
    db = false;
  }

  return NextResponse.json({ ok: true, db });
}
