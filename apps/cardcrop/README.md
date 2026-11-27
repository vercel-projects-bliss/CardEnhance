# CardCrop Seller Studio — canonical card application

This is the maintained card app. It combines the recovered CardCrop Studio source
with CardEnhance's sheet detection/perspective geometry and Text Studio's local
English OCR. The old applications remain as source/history backups; they are not
required to run this app. JugginAI is unrelated and unchanged.

## Run and check

Node 24; run commands in `apps/cardcrop`:

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm start
```

Asset preparation copies the versioned detection models, ONNX runtime files and
real card samples from this repository's root `public/`. OCR worker, WASM and
English data come from locked npm packages. Do not commit generated assets.
Vercel's project root is `apps/cardcrop`, with source files outside the root
available for asset preparation. The Next.js build does not run the legacy
root Vite app or its database migrations.

## Main workflow

`/` is a browser-only seller desk: import JPG/PNG/WebP or ZIP, optionally split
and rectify multi-card sheets, optionally read English text locally, pair by
SKU/front/back, edit card/listing details, explicitly review, then export.
`/batch` redirects here. The workflow does not upload images to a service or
publish listings. Reloading or closing clears the in-memory batch, so download
before leaving. Maximum 100 images and 150 MB of source data; decoded inputs
are capped at 60 megapixels. Working images are limited to 2400px long edge;
unchanged originals are included in the download.

ZIP includes PNG images, original source files, a CSV review worksheet, and a
manifest linking each output to its SKU. CSV is **not** an eBay bulk-upload
schema. Unknown sides must be reviewed; incomplete pairs are flagged but
single-sided exports are allowed. OCR text is unverified and does not invent
wrestler names, sets, card numbers or condition assessments.

No scratch/blemish removal or generative enhancement runs in the seller desk.
The explicit restoration and creative tools remain available separately within
this same app for users who choose them.

## Retained authenticated tools

- `/editor`: single-card crop/perspective/tone, cloud identification and storage
- `/auto-enhance`: adaptive pipeline, optional hosted GPU/Replicate restoration
- `/suite`: card library and configured connection status
- `/assistant`: card assistant
- `/create`: creative image tools

Cloud APIs and stored library records still require the existing password or
Neon session. Local processing does not bypass those API gates. Existing
CardCrop Studio environment configuration is preserved, not copied from other
projects. Optional integrations remain unavailable until their credentials and
services are configured. Do not put credentials in source or issue comments.

## Provenance

- CardCrop Studio production source recovered through Vercel's deployment-file API.
- `src/lib/vision/*`: ported from this repository's CardEnhance implementation.
- `src/lib/ocr/browser-worker.ts` and OCR asset preparation: ported from
  `vercel-projects-bliss/my-nextjs-site` (Text Studio).
- Existing CardCrop pixel/foil controls and provider integrations retain the
  previous consolidation of Card-Enhancer and cardenhance-v3 GPU proxy features.

The legacy Python training/inference projects require external services and
trained checkpoints. Their existence is not evidence of a working trained
valuation/defect model, and this app makes no automated grading claim.
