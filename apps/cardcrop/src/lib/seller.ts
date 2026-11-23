export type SellerCard = {
  id: string;
  filename: string;
  sku: string;
  side: 'front' | 'back' | 'unknown';
  title: string;
  wrestler: string;
  year: string;
  set: string;
  number: string;
  parallel: string;
  price: string;
  notes: string;
  rawText: string;
  reviewed: boolean;
};

export function inferScan(filename: string) {
  const stem = filename.replace(/\.[^.]+$/, '');
  const match = stem.match(/^(.*?)[_\s.-]+(front|back|f|b)$/i);
  return {
    sku: (match?.[1] || stem).replace(/[^\w.-]+/g, '-'),
    side: match ? (/^(front|f)$/i.test(match[2]) ? 'front' : 'back') as 'front' | 'back' : 'unknown' as const,
  };
}

// Spreadsheets execute formula cells even when they are quoted.
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function listingCsv(cards: SellerCard[]): string {
  const header = ['sku','side','filename','title','wrestler','year','set','card_number','parallel','price','condition_notes','reviewed','ocr_text'];
  return [header.join(','), ...cards.map(c => [c.sku,c.side,c.filename,c.title,c.wrestler,c.year,c.set,c.number,c.parallel,c.price,c.notes,c.reviewed ? 'yes' : 'no',c.rawText].map(csvCell).join(','))].join('\r\n');
}

export function listingGroups(cards: SellerCard[]) {
  const groups = new Map<string, SellerCard[]>();
  for (const card of cards) groups.set(card.sku, [...(groups.get(card.sku) || []), card]);
  return [...groups.entries()].map(([sku, scans]) => ({
    sku, scans,
    paired: scans.filter(c => c.side === 'front').length === 1 && scans.filter(c => c.side === 'back').length === 1 && scans.length === 2,
    reviewed: scans.every(c => c.reviewed),
  }));
}

export function outputName(card: SellerCard, index: number) {
  const safe = card.sku.replace(/[^\w.-]/g, '-').replace(/^\.+/, '') || 'card';
  return `${String(index + 1).padStart(4,'0')}-${safe}-${card.side}.png`;
}
