import { put } from "@vercel/blob";

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export async function storeImage(pathname: string, body: Blob | Buffer, contentType: string) {
  if (!blobConfigured()) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  }
  return put(pathname, body, {
    access: "public",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    contentType,
    addRandomSuffix: true,
  });
}
