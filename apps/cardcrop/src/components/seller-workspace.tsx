'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';
import type { Worker } from 'tesseract.js';
import { PixelPreview } from '@/components/pixel-preview';
import { canvasFromImageData, fitLongEdge, imageDataFromPixels, loadImageElement, paintPaddedCard, readImageData } from '@/lib/client/image';
import { inferScan, listingCsv, listingGroups, outputName, type SellerCard } from '@/lib/seller';
import { initializeOcrWorker } from '@/lib/ocr/browser-worker';
import type { AdaptiveAuditMetrics } from '@/lib/pipeline/adaptiveCardPipeline';

type Scan = SellerCard & {
 source: File;
 image: ImageData;
 output?: Blob;
 outputWidth?: number;
 outputHeight?: number;
 restoration?: AdaptiveAuditMetrics;
 error?: string;
};
const MAX_FILES = 100;
const MAX_BYTES = 150 * 1024 * 1024;

function saveBlob(blob: Blob, filename: string) {
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
 setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function SellerWorkspace() {
 const [scans, setScans] = useState<Scan[]>([]);
 const [busy, setBusy] = useState('');
 const [error, setError] = useState('');
 const [ocr, setOcr] = useState(false);
 const [split, setSplit] = useState(false);
 const [restore, setRestore] = useState(false);
 const [message, setMessage] = useState('');
 const lock = useRef(false);
 const workerRef = useRef<Worker | null>(null);
 useEffect(() => () => { void workerRef.current?.terminate(); }, []);
 useEffect(() => {
  if (!scans.length) return;
  const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
 }, [scans.length]);
 const groups = listingGroups(scans);
 const completed = scans.filter(s => s.output);
 const reviewed = completed.filter(s => s.reviewed);

 function patch(id: string, update: Partial<Scan>) {
  setScans(current => current.map(s => s.id === id ? {...s, ...update} : s));
 }
 async function task(label: string, fn: () => Promise<void>) {
  if (lock.current) return;
  lock.current = true; setBusy(label); setError(''); setMessage('');
  try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Operation failed'); }
  finally { lock.current = false; setBusy(''); }
 }
 async function addFiles(incoming: File[]) {
  const files: File[] = [];
  let bytes = scans.reduce((n,s) => n + s.source.size,0);
  for (const f of incoming) {
   if (/\.zip$/i.test(f.name)) {
    if (f.size > MAX_BYTES) throw new Error('Archive exceeds 150 MB.');
    const zip = await JSZip.loadAsync(f);
    const entries = Object.values(zip.files).filter(e => !e.dir && /\.(jpe?g|png|webp)$/i.test(e.name));
    if (entries.length + files.length + scans.length > MAX_FILES) throw new Error('Use batches of up to 100 images.');
    // Check metadata before allocating decompressed blobs, then enforce actual sizes too.
    const expected = entries.reduce((n,e) => n + ((e as unknown as {_data?: {uncompressedSize?: number}})._data?.uncompressedSize || 0),0);
    if (bytes + expected > MAX_BYTES) throw new Error('Expanded archive exceeds 150 MB.');
    for (const entry of entries) {
     const blob = await entry.async('blob'); bytes += blob.size;
     if (bytes > MAX_BYTES) throw new Error('Expanded archive exceeds 150 MB.');
     files.push(new File([blob],entry.name.split('/').pop() || entry.name));
    }
   } else {
    if (!/\.(jpe?g|png|webp)$/i.test(f.name)) throw new Error('Choose JPG, PNG, WebP, or a ZIP of those images.');
    bytes += f.size; files.push(f);
   }
  }
  if (scans.length + files.length > MAX_FILES || bytes > MAX_BYTES) throw new Error('Limit: 100 images and 150 MB per batch.');
  if (!files.length) throw new Error('No supported images found.');
  const added: Scan[] = [];
  for (const source of files) {
   const img = await loadImageElement(source);
   if (img.naturalWidth * img.naturalHeight > 60_000_000) throw new Error(`${source.name}: maximum 60 megapixels.`);
   const fit = fitLongEdge(img.naturalWidth,img.naturalHeight,420);
   added.push({id:crypto.randomUUID(),filename:source.name,...inferScan(source.name),source,image:readImageData(img,fit.width,fit.height),title:'',wrestler:'',year:'',set:'',number:'',parallel:'',price:'',notes:'',rawText:'',reviewed:false});
  }
  setScans(current => [...current,...added]);
 }
 async function sample() {
  await task('Loading wrestling-card sample…',async () => {
   const files = await Promise.all(['front','back'].map(async side => {
    const response = await fetch(`/samples/seller-${side}.jpg`);
    if (!response.ok) throw new Error('Sample image unavailable');
    return new File([await response.blob()],`mina-shirakawa-dazzlers-${side}.jpg`,{type:'image/jpeg'});
   }));
   await addFiles(files);
  });
 }
 async function process() {
  await task('Preparing cards…',async () => {
   let worker: Worker | null = null;
   try {
    if (ocr) {
     setBusy('Loading browser OCR…');
     worker = await initializeOcrWorker({workerPath:'/ocr/worker.min.js',corePath:'/ocr/',langPath:'/ocr/',workerBlobURL:false});
     workerRef.current = worker;
    }
    const pipeline = restore ? await import('@/lib/pipeline/adaptiveCardPipeline') : null;
    const next: Scan[] = [];
    for (const [index,scan] of scans.entries()) {
     if (scan.output) { next.push(scan); continue; }
     setBusy(`Processing ${index+1} of ${scans.length}…`);
     try {
      const original = await loadImageElement(scan.source);
      const fit = fitLongEdge(original.naturalWidth, original.naturalHeight, 2400);
      const working = readImageData(original, fit.width, fit.height);
      let images = [working];
      if (split) {
       const {detectCards,rectifyCard} = await import('@/lib/vision/detect-sheet');
       const detections = await detectCards(working);
       if (next.length + detections.length + scans.length - index - 1 > MAX_FILES) throw new Error('Sheet detection exceeds 100-card batch limit.');
       images = detections.map(d => rectifyCard(working,d));
      }
      const preparedScans: Scan[] = [];
      for (const [part, detected] of images.entries()) {
       let image = detected;
       let restoration: AdaptiveAuditMetrics | undefined;
       if (pipeline) {
        const fit = fitLongEdge(image.width, image.height, 1400);
        if (fit.width !== image.width || fit.height !== image.height) {
         image = readImageData(canvasFromImageData(image), fit.width, fit.height);
        }
        const result = await pipeline.runAdaptiveCardPipeline(image.data, image.width, image.height, {
         mode: 'adaptive', scale: 1, maxLongEdge: 1800, manualRotationDeg: 0,
        });
        image = imageDataFromPixels(result.rgba, result.width, result.height);
        restoration = result.audit;
       }
       const row: Scan = {...scan,id:part ? crypto.randomUUID() : scan.id,image,restoration,error:undefined,reviewed:false};
       if (images.length > 1) { row.filename = scan.filename.replace(/\.[^.]+$/,'')+`-card-${part+1}.png`; row.sku += `-${part+1}`; }
       const prepared = paintPaddedCard(canvasFromImageData(image),image.width,image.height).canvas;
       const blob = await new Promise<Blob | null>(resolve => prepared.toBlob(resolve, 'image/png'));
       if (!blob) throw new Error('Could not encode prepared image');
       row.output = blob; row.outputWidth = prepared.width; row.outputHeight = prepared.height;
       const previewFit = fitLongEdge(image.width, image.height, 420);
       row.image = readImageData(canvasFromImageData(image), previewFit.width, previewFit.height);
       if (worker) {
        try { row.rawText = (await worker.recognize(canvasFromImageData(detected))).data.text.trim(); }
        catch (err) { row.error = `Image ready; OCR failed: ${err instanceof Error ? err.message : 'unknown error'}`; }
       }
       preparedScans.push(row);
      }
      next.push(...preparedScans);
     } catch (err) { next.push({...scan,error:err instanceof Error ? err.message : 'Processing failed'}); }
    }
    setScans(next); setMessage('Images prepared. Review the details, assign matching SKUs to fronts/backs, then export.');
   } finally { if (worker) await worker.terminate(); workerRef.current = null; }
  });
 }
 async function exportBatch() {
  await task('Building download…', async () => {
   const selected = scans.filter(s => s.output && s.reviewed);
   if (!selected.length) throw new Error('Review at least one prepared scan first.');
   const zip = new JSZip();
   const manifest = [];
   for (const [i,s] of selected.entries()) {
    const name = outputName(s,i);
    const blob = s.output;
    if (!blob) throw new Error(`Could not encode ${s.filename}`);
    zip.file(`images/${name}`,blob);
    zip.file(`originals/${String(i+1).padStart(4,'0')}-${s.source.name.replace(/[^\w.-]/g,'-')}`,s.source);
    const {source: _source,image: _image,output: _output,...metadata} = s;
    void _source; void _image; void _output;
    manifest.push({...metadata,exportedImage:`images/${name}`});
   }
   zip.file('listing-data.csv',listingCsv(selected));
   zip.file('manifest.json',JSON.stringify(manifest,null,2));
   zip.file('README.txt','Reviewed listing data, processed images, and original scans. CSV is a review worksheet, not an eBay bulk-upload template. No listings were published. Pair by matching SKU and front/back side. Originals are unchanged. Prepared images may be resized, padded, or rectified. If CardEnhance ran, the manifest includes its restoration audit. Use originals to disclose card condition.');
   saveBlob(await zip.generateAsync({type:'blob'}),'CardCrop-seller-batch.zip');
   setMessage(`Exported ${selected.length} reviewed scans with originals and listing data.`);
  });
 }
 return <div className="shell seller"><header className="topbar"><Link href="/" className="seller-brand">CARDCROP <span>SELLER STUDIO</span></Link><nav className="nav" aria-label="Studio tools"><Link href="/editor">Editor</Link><Link href="/auto-enhance">Restore</Link><Link href="/suite">Library</Link><Link href="/assistant">Assistant</Link><Link href="/create">Create</Link></nav></header>
 <main className="main"><div className="seller-hero"><p className="kicker">WRESTLING CARDS · SCAN TO LISTING</p><h1>One batch. One workflow.<br/>Ready for your next sale.</h1><p className="muted">Import → prepare → pair & review → export. Your originals stay intact. Local processing needs no login; cloud tools keep their existing sign-in.</p></div>
 <div className="seller-stats"><span><strong>{scans.length}</strong> scans</span><span><strong>{completed.length}</strong> prepared</span><span><strong>{groups.filter(g=>g.paired).length}</strong> front/back pairs</span><span><strong>{reviewed.length}</strong> reviewed</span></div>
 <section className="panel"><h2>1. Import & prepare</h2><div className="drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy) void task('Importing scans…',()=>addFiles(Array.from(e.dataTransfer.files)));}}><label>Drop scans or ZIP here, or choose files <input aria-label="Import card scans" type="file" multiple disabled={!!busy} accept=".jpg,.jpeg,.png,.webp,.zip" onChange={e=>{const f=Array.from(e.target.files||[]);e.target.value='';if(f.length) void task('Importing scans…',()=>addFiles(f));}}/></label><p className="muted">Up to 100 images / 150 MB. Preview and prepared images are limited to 2400 px; the download includes unchanged originals.</p></div>
 <div className="row seller-actions"><button className="btn-ghost" disabled={!!busy} onClick={()=>void sample()}>Use wrestling-card sample</button></div>
 <fieldset className="seller-options" disabled={!!busy || !!completed.length}>
  <legend>Optional processing</legend>
  <label><input type="checkbox" checked={split} onChange={e=>setSplit(e.target.checked)}/> Detect & straighten multi-card sheets</label>
  <label><input type="checkbox" checked={restore} onChange={e=>setRestore(e.target.checked)}/> Restore scans with CardEnhance</label>
  <label><input type="checkbox" checked={ocr} onChange={e=>setOcr(e.target.checked)}/> Read text locally (English OCR)</label>
 </fieldset>
 <div className="row seller-actions"><button className="btn" disabled={!!busy || !scans.some(s=>!s.output)} onClick={()=>void process()}>Prepare cards</button></div>
 <p className="muted">CardEnhance adjusts alignment, dust, and tone in your browser without generating new artwork. Review restored copies against the originals before listing. OCR text does not verify card identity. To change these options after preparation, clear and reimport the batch.</p></section>
 <div role="status" aria-live="polite">{busy || message}</div>{error && <p role="alert" className="error">{error}</p>}
 {scans.length>0 && <section><div className="row seller-actions"><h2>2. Pair & review</h2><button className="btn-ghost" disabled={!!busy} onClick={()=>{setScans([]);setMessage('');}}>Clear batch</button></div><p className="muted">Matching SKUs group scans. Filename suffixes “front” and “back” are recognized; other sides need your review. Nothing is auto-published.</p>
 <div className="seller-grid">{scans.map(s=><article className="panel seller-card" key={s.id}><div className="seller-preview"><PixelPreview image={s.image} label={s.filename}/></div><strong>{s.filename}</strong><span className="muted">{s.output ? `${s.outputWidth} × ${s.outputHeight} · ${s.restoration ? 'restored' : 'prepared'}` : 'Awaiting preparation'}</span>{s.error && <p className="error">{s.error}</p>}<div className="seller-fields">
 <label>SKU / pair ID<input disabled={!!busy} value={s.sku} onChange={e=>patch(s.id,{sku:e.target.value,reviewed:false})}/></label><label>Side<select disabled={!!busy} value={s.side} onChange={e=>patch(s.id,{side:e.target.value as Scan['side'],reviewed:false})}><option value="unknown">Unknown</option><option value="front">Front</option><option value="back">Back</option></select></label>
 {(['title','wrestler','year','set','number','parallel','price','notes'] as const).map(field=><label key={field}>{({title:'Listing title',wrestler:'Wrestler',year:'Year',set:'Set',number:'Card number',parallel:'Parallel / serial',price:'Asking price',notes:'Condition notes'})[field]}<input disabled={!!busy} value={s[field]} onChange={e=>patch(s.id,{[field]:e.target.value,reviewed:false})}/></label>)}
 </div>{s.rawText && <details><summary>Extracted text (unverified)</summary><pre style={{whiteSpace:'pre-wrap'}}>{s.rawText}</pre></details>}<label className="row"><input type="checkbox" checked={s.reviewed} disabled={!!busy || !s.output || !s.sku.trim() || s.side==='unknown'} onChange={e=>patch(s.id,{reviewed:e.target.checked})}/> I reviewed this scan and its details</label></article>)}</div>
 <section className="panel seller-export"><h2>3. Export reviewed scans</h2><p>{groups.filter(g=>!g.paired).length} SKU groups have a missing, unknown, or duplicate side. Single-sided exports are allowed.</p><p className="muted">ZIP includes prepared PNGs, unchanged originals, a listing-data CSV, and a manifest linking images to SKUs. This is not an eBay bulk-upload template.</p><button className="btn" disabled={!!busy || !reviewed.length} onClick={()=>void exportBatch()}>Download seller ZIP ({reviewed.length})</button></section></section>}
 </main></div>;
}
