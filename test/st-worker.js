/* Supertonic 3 (int8) im Hintergrund-Thread.
   {type:'init', threads, modelBase, cacheName}  -> {type:'ready', initMs, threads, isolated}
   {type:'synth', id, text, lang, sid, steps, speed} -> {type:'audio', id, pcm, sr, ms, audioSec}
   Fehler -> {type:'error', id, message} */
importScripts('ort/ort.wasm.min.js');
const BASE = new URL('./', self.location.href).href;
let M = null;

async function getFile(url, cacheName) {
  try { const c = await caches.open(cacheName); const hit = await c.match(url); if (hit) return await hit.arrayBuffer(); } catch (e) {}
  const r = await fetch(url); if (!r.ok) throw new Error(url.split('/').pop() + ': HTTP ' + r.status);
  return await r.arrayBuffer();
}

async function init({ threads, modelBase, cacheName }) {
  const t0 = performance.now();
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.wasmPaths = BASE + 'ort/';
  const f = n => getFile(modelBase + n, cacheName);
  const [dp, te, ve, vo, cfgBuf, idx, vb] = await Promise.all([
    f('duration_predictor.int8.onnx'), f('text_encoder.int8.onnx'), f('vector_estimator.int8.onnx'), f('vocoder.int8.onnx'),
    f('tts.json'), f('unicode_indexer.bin'), f('voice.bin')]);
  const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  M = {};
  M.dp = await ort.InferenceSession.create(new Uint8Array(dp), opt);
  M.te = await ort.InferenceSession.create(new Uint8Array(te), opt);
  M.ve = await ort.InferenceSession.create(new Uint8Array(ve), opt);
  M.vo = await ort.InferenceSession.create(new Uint8Array(vo), opt);
  M.cfg = JSON.parse(new TextDecoder().decode(cfgBuf));
  M.idx = new Int32Array(idx);
  const h = Array.from(new BigInt64Array(vb, 0, 6), Number);   // [n,50,256, n,8,16]
  const n = h[0], tl = h[1] * h[2], dl = h[4] * h[5];
  const ttl = new Float32Array(vb, 48, n * tl), dps = new Float32Array(vb, 48 + n * tl * 4, n * dl);
  M.style = sid => ({
    ttl: new ort.Tensor('float32', ttl.slice(sid * tl, (sid + 1) * tl), [1, h[1], h[2]]),
    dp: new ort.Tensor('float32', dps.slice(sid * dl, (sid + 1) * dl), [1, h[4], h[5]])
  });
  return { initMs: performance.now() - t0, threads: ort.env.wasm.numThreads, isolated: self.crossOriginIsolated === true };
}

// Textaufbereitung wie im offiziellen Supertonic-Beispiel
function prep(text, lang) {
  text = text.normalize('NFKD');
  const rep = { '–': '-', '‑': '-', '—': '-', '_': ' ', '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'", '‚': "'",
    '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '»': '"', '«': '"' };
  for (const [k, v] of Object.entries(rep)) text = text.split(k).join(v);
  text = text.replace(/\s+/g, ' ').replace(/ ([,.!?;:])/g, '$1').trim();
  if (!/[.!?;:,'")\]}…]$/.test(text)) text += '.';
  return `<${lang}>${text}</${lang}>`;
}

async function synth({ text, lang, sid = 0, steps = 8, speed = 1.05 }) {
  const t0 = performance.now();
  const s = prep(text, lang), L = s.length;
  const ids = new BigInt64Array(L);
  for (let j = 0; j < L; j++) { const c = s.codePointAt(j); ids[j] = BigInt(c < M.idx.length ? M.idx[c] : -1); }
  const st = M.style(sid);
  const textIds = new ort.Tensor('int64', ids, [1, L]);
  const textMask = new ort.Tensor('float32', new Float32Array(L).fill(1), [1, 1, L]);
  const dur = (await M.dp.run({ text_ids: textIds, style_dp: st.dp, text_mask: textMask })).duration.data[0] / speed;
  const emb = (await M.te.run({ text_ids: textIds, style_ttl: st.ttl, text_mask: textMask })).text_emb;
  const sr = M.cfg.ae.sample_rate, chunk = M.cfg.ae.base_chunk_size * M.cfg.ttl.chunk_compress_factor;
  const latLen = Math.max(1, Math.floor((Math.floor(dur * sr) + chunk - 1) / chunk));
  const latDim = M.cfg.ttl.latent_dim * M.cfg.ttl.chunk_compress_factor;
  let xt = new Float32Array(latDim * latLen);
  for (let i = 0; i < xt.length; i++) { const u1 = Math.max(1e-4, Math.random()), u2 = Math.random(); xt[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); }
  const latMask = new ort.Tensor('float32', new Float32Array(latLen).fill(1), [1, 1, latLen]);
  const tot = new ort.Tensor('float32', new Float32Array([steps]), [1]);
  for (let k = 0; k < steps; k++) {
    const out = await M.ve.run({ noisy_latent: new ort.Tensor('float32', xt, [1, latDim, latLen]), text_emb: emb, style_ttl: st.ttl,
      latent_mask: latMask, text_mask: textMask, current_step: new ort.Tensor('float32', new Float32Array([k]), [1]), total_step: tot });
    xt = out.denoised_latent.data;
  }
  const wav = (await M.vo.run({ latent: new ort.Tensor('float32', xt, [1, latDim, latLen]) })).wav_tts.data;
  const n = Math.min(wav.length, Math.floor(dur * sr));
  const pcm = Float32Array.from(wav.subarray(0, n));
  return { pcm, sr, ms: performance.now() - t0, audioSec: n / sr };
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') self.postMessage({ type: 'ready', ...(await init(m)) });
    else if (m.type === 'synth') { const r = await synth(m); self.postMessage({ type: 'audio', id: m.id, ...r }, [r.pcm.buffer]); }
  } catch (e) { self.postMessage({ type: 'error', id: m.id, message: (e && e.message) || String(e) }); }
};
