import { describe, it, expect } from 'vitest';
import { inferScan, csvCell, listingCsv, listingGroups, outputName, type SellerCard } from '@/lib/seller';
const card = (id: string, side: SellerCard['side']): SellerCard => ({id,side,filename:`${id}.jpg`,sku:'wwe-42',title:'Test',wrestler:'',year:'',set:'',number:'',parallel:'',price:'',notes:'',rawText:'',reviewed:false});
describe('seller workflow', () => {
 it('pairs explicit filename suffixes without guessing sequential files', () => {
  expect(inferScan('wwe-42_front.jpg')).toEqual({sku:'wwe-42',side:'front'});
  expect(inferScan('wwe-42-back.png')).toEqual({sku:'wwe-42',side:'back'});
  expect(inferScan('scan42.jpg').side).toBe('unknown');
 });
 it('flags duplicate fronts instead of claiming a valid pair', () => {
  expect(listingGroups([card('a','front'),card('b','back')])[0].paired).toBe(true);
  expect(listingGroups([card('a','front'),card('b','front')])[0].paired).toBe(false);
 });
 it('escapes formulas, commas, multiline notes and quotes', () => {
  expect(csvCell('=1+1')).toBe('"\'=1+1"');
  expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  expect(listingCsv([card('a','front')])).toContain('condition_notes,reviewed,ocr_text');
 });
 it('makes archive names unique and cannot traverse paths', () => {
  const c={...card('a','front'),sku:'../../wwe'};
  expect(outputName(c,0)).not.toContain('/');
  expect(outputName(c,0)).not.toEqual(outputName(c,1));
 });
});
