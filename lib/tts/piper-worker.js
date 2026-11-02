/* Piper-Sprachsynthese im Hintergrund-Thread.
   Nachrichten an den Worker:
     {type:'init', model:ArrayBuffer, config:Object}
     {type:'synth', id, text}
   Antworten:
     {type:'ready', sampleRate} | {type:'audio', id, pcm:Float32Array} | {type:'error', id, message} */
importScripts('ort.wasm.min.js', 'piper_phonemize.js');

const BASE = new URL('./', self.location.href).href;
ort.env.wasm.numThreads = 1;          // GitHub Pages liefert keine COOP/COEP-Header → kein SharedArrayBuffer
ort.env.wasm.wasmPaths = BASE;

let session = null, config = null, phonemizer = null;
let wasmBinary = null, dataPackage = null;

async function loadPhonemizerAssets() {
  if (wasmBinary) return;
  const [w, d] = await Promise.all([
    fetch(BASE + 'piper_phonemize.wasm').then(r => { if (!r.ok) throw new Error('piper_phonemize.wasm ' + r.status); return r.arrayBuffer(); }),
    fetch(BASE + 'piper_phonemize.data').then(r => { if (!r.ok) throw new Error('piper_phonemize.data ' + r.status); return r.arrayBuffer(); })
  ]);
  wasmBinary = w; dataPackage = d;
}

// Eine Emscripten-Instanz wird für alle Sätze wiederverwendet; bei einem Fehler wird sie neu angelegt.
let printed = null;
function newPhonemizer() {
  return createPiperPhonemize({
    print: line => { printed = line; },
    printErr: () => {},
    wasmBinary,
    getPreloadedPackage: () => dataPackage,
    locateFile: f => BASE + f,
    noInitialRun: true
  });
}

async function phonemize(text) {
  if (!phonemizer) phonemizer = newPhonemizer();
  const args = ['-l', config.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data'];
  printed = null;
  try { (await phonemizer).callMain(args); }
  catch (e) { phonemizer = newPhonemizer(); printed = null; (await phonemizer).callMain(args); }
  if (!printed) throw new Error('Phonemisierung fehlgeschlagen');
  const res = JSON.parse(printed);
  const map = config.phoneme_id_map;
  if (!map || !Array.isArray(res.phonemes)) return res.phoneme_ids;
  // IDs aus der Lauttabelle des Modells bilden (wie Piper: ^ _ p1 _ p2 _ … $)
  const pad = map['_'] || [0], ids = [];
  const push = arr => { for (const id of arr) { ids.push(id); ids.push(...pad); } };
  if (map['^']) push(map['^']);
  for (const ph of res.phonemes) if (map[ph]) push(map[ph]);
  if (map['$']) ids.push(...map['$']);
  return ids;
}

async function synth(text) {
  const ids = await phonemize(text);
  const inf = config.inference || {};
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, inf.length_scale ?? 1, inf.noise_w ?? 0.8]), [3])
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const out = await session.run(feeds);
  const pcm = out.output.data;
  return pcm instanceof Float32Array ? pcm : Float32Array.from(pcm);
}

// Aufträge strikt nacheinander abarbeiten
let queue = Promise.resolve();
self.onmessage = ({ data: m }) => {
  queue = queue.then(async () => {
    try {
      if (m.type === 'init') {
        config = m.config;
        await loadPhonemizerAssets();
        session = await ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ['wasm'] });
        phonemizer = newPhonemizer();
        await phonemizer;
        self.postMessage({ type: 'ready', sampleRate: config.audio.sample_rate });
      } else if (m.type === 'synth') {
        const pcm = await synth(m.text);
        self.postMessage({ type: 'audio', id: m.id, pcm }, [pcm.buffer]);
      }
    } catch (e) {
      self.postMessage({ type: 'error', id: m.id, message: (e && e.message) || String(e) });
    }
  });
};
