import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/auth/neon', () => ({neonAuthConfigured:()=>false,getNeonAuth:()=>null}));
vi.mock('@/lib/auth/password', () => ({SESSION_COOKIE:'ccs_session',verifySessionToken:()=>false}));
import { proxy } from '@/proxy';
describe('local workspace and protected cloud APIs', () => {
 it('allows the browser-only workflow signed out', async () => {
  const response=await proxy(new NextRequest('https://studio.example/'));
  expect(response.status).toBe(200);
 });
 it.each(['/api/ocr','/api/cards','/api/blob','/api/restore','/api/runpod/enhance'])('keeps %s behind authentication', async path => {
  const response=await proxy(new NextRequest('https://studio.example'+path));
  expect(response.status).toBe(401);
 });
});
