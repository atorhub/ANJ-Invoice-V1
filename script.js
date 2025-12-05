// script.js (robust loader + diagnostics + core features)
// Overwrites previous script.js. Meant to be a drop-in replacement.
// Adds visible error box, library checks, delayed init and safe-fail behavior.

(function(){
  // mark that script loaded
  window.appInitialized = true;

  /* ---------- UI helpers ---------- */
  function $(id){ return document.getElementById(id); }
  function show(el){ if(!el) return; el.classList.remove('hidden'); }
  function hide(el){ if(!el) return; el.classList.add('hidden'); }
  function safeText(s){ return s==null ? '' : String(s); }
  function addMsg(msg, type='info'){
    const root = ensureDiagnostics();
    const p = document.createElement('div');
    p.style.padding = '6px 8px';
    p.style.borderTop = '1px solid rgba(255,255,255,0.03)';
    p.style.fontSize = '13px';
    p.style.color = type==='err' ? '#ffb4b4' : '#cfc3a9';
    p.textContent = msg;
    root.appendChild(p);
  }
  function ensureDiagnostics(){
    let d = document.getElementById('anjDiagnostics');
    if(d) return d;
    d = document.createElement('div');
    d.id = 'anjDiagnostics';
    d.style.position = 'fixed';
    d.style.right = '12px';
    d.style.bottom = '12px';
    d.style.maxWidth = '320px';
    d.style.background = 'rgba(10,10,10,0.84)';
    d.style.border = '1px solid rgba(255,255,255,0.04)';
    d.style.borderRadius = '8px';
    d.style.zIndex = 99999;
    d.style.padding = '8px';
    d.style.boxShadow = '0 8px 30px rgba(0,0,0,0.6)';
    const title = document.createElement('div');
    title.textContent = 'ANJ Debug';
    title.style.fontWeight = '800';
    title.style.color = '#ffd973';
    title.style.marginBottom = '6px';
    d.appendChild(title);
    document.body.appendChild(d);
    return d;
  }

  /* ---------- Library presence checks ---------- */
  function checkLibs(){
    const libs = {
      pdfjsLib: (typeof pdfjsLib !== 'undefined'),
      Tesseract: (typeof Tesseract !== 'undefined'),
      html2canvas: (typeof html2canvas !== 'undefined'),
      jspdf: (typeof jspdf !== 'undefined'),
      Chart: (typeof Chart !== 'undefined')
    };
    return libs;
  }

  /* ---------- Safe init: wait for DOM + libs ---------- */
  async function safeInit(){
    // wait DOM
    if(document.readyState === 'loading'){
      await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }

    // add minimal UI diagnostics area
    ensureDiagnostics();
    addMsg('Initializing app...', 'info');

    // check libs now
    const libs = checkLibs();
    for(const k in libs){
      if(!libs[k]) addMsg(`${k} not loaded`, 'err');
      else addMsg(`${k} loaded`, 'info');
    }

    // attach UI elements safely (verify IDs)
    const requiredIds = ['fileInput','parseBtn','ocrBtn','historyList','exportAllBtn','clearAllBtn','generateBtn','saveBtn','downloadPDFBtn','printBtn','regenerateBtn','parsedCard','invoiceCard','invoiceArea','metaBlock','itemsBlock','categoryChart','monthlyChart'];
    requiredIds.forEach(id=>{
      const e = $(id);
      addMsg(`Element "${id}": ${e ? 'OK' : 'MISSING'}`, e ? 'info' : 'err');
    });

    // If critical libs missing, still attach limited functionality and return
    if(!libs.pdfjsLib && !libs.Tesseract){
      addMsg('Both pdf.js and Tesseract are missing — parsing disabled.', 'err');
      attachLimitedHandlers();
      return;
    }

    // If HTML2Canvas or jspdf missing disable PDF export button
    if(!libs.html2canvas || !libs.jspdf){
      addMsg('html2canvas/jsPDF missing — download PDF disabled but parsing will work.', 'err');
      const dl = $('downloadPDFBtn'); if(dl) dl.disabled = true;
    }

    // If Chart.js missing, disable analytics area
    if(!libs.Chart){
      addMsg('Chart.js missing — analytics disabled.', 'err');
    }

    // now attach full handlers
    attachHandlers();
    addMsg('Initialization complete ✅', 'info');
  }

  /* ---------- Fallback UI when no libs ---------- */
  function attachLimitedHandlers(){
    const parseBtn = $('parseBtn');
    if(parseBtn){
      parseBtn.addEventListener('click', ()=> alert('Parsing disabled: pdf.js or Tesseract not available.'));
    }
    const ocrBtn = $('ocrBtn');
    if(ocrBtn){
      ocrBtn.addEventListener('click', ()=> alert('OCR disabled: Tesseract not available.'));
    }
    const exportBtn = $('exportAllBtn');
    if(exportBtn) exportBtn.addEventListener('click', ()=> alert('Export currently disabled.'));
    // still try to load history if DB exists
    loadHistorySafe().catch(err=>addMsg('History load failed: '+err,'err'));
  }

  /* ---------- Attach full handlers ---------- */
  function attachHandlers(){
    // handlers map
    const parseBtn = $('parseBtn');
    const ocrBtn = $('ocrBtn');
    const fileInput = $('fileInput');
    const generateBtn = $('generateBtn');
    const saveBtn = $('saveBtn');
    const downloadPDFBtn = $('downloadPDFBtn');
    const printBtn = $('printBtn');
    const exportAllBtn = $('exportAllBtn');
    const clearAllBtn = $('clearAllBtn');
    const parsedCard = $('parsedCard');
    const invoiceCard = $('invoiceCard');

    // safety: if an element missing, show message and early-return for that button
    if(parseBtn) parseBtn.addEventListener('click', onParseClicked);
    if(ocrBtn) ocrBtn.addEventListener('click', onOcrClicked);
    if(generateBtn) generateBtn.addEventListener('click', onGenerateClicked);
    if(saveBtn) saveBtn.addEventListener('click', onSaveClicked);
    if(downloadPDFBtn) downloadPDFBtn.addEventListener('click', onDownloadPDF);
    if(printBtn) printBtn.addEventListener('click', ()=> window.print());
    if(exportAllBtn) exportAllBtn.addEventListener('click', onExportAll);
    if(clearAllBtn) clearAllBtn.addEventListener('click', onClearAll);

    // load history into UI
    loadHistorySafe().catch(e=> addMsg('History load error: '+e,'err'));
  }

  /* ---------- Core: parse / OCR wrappers ---------- */
  async function onParseClicked(){
    const f = $('fileInput') && $('fileInput').files && $('fileInput').files[0];
    if(!f) return alert('Choose a file first');
    try{
      addMsg('Starting parse for: '+f.name);
      let txt = '';
      if(/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)){
        if(typeof pdfjsLib === 'undefined') throw new Error('pdf.js missing');
        txt = await extractPDFSafe(f);
      } else if(f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name)){
        if(typeof Tesseract === 'undefined') throw new Error('Tesseract missing');
        txt = await extractImageSafe(f);
      } else {
        txt = await f.text();
      }
      const parsed = await parseRawTextSafe(txt);
      window.__lastParsed = parsed;
      renderParsed(parsed);
      addMsg('Parse completed');
    }catch(err){
      console.error(err);
      addMsg('Parse error: '+(err&&err.message?err.message:err),'err');
      alert('Parse failed: '+(err&&err.message?err.message:err));
    }
  }

  async function onOcrClicked(){
    const f = $('fileInput') && $('fileInput').files && $('fileInput').files[0];
    if(!f) return alert('Choose an image first');
    if(typeof Tesseract === 'undefined') return alert('Tesseract not loaded');
    try{
      addMsg('Starting OCR for: '+f.name);
      const txt = await extractImageSafe(f);
      const parsed = await parseRawTextSafe(txt);
      window.__lastParsed = parsed;
      renderParsed(parsed);
    }catch(err){
      addMsg('OCR error: '+(err.message||err),'err');
    }
  }

  /* ---------- Actual extractors with try/catch and timeouts ---------- */
  async function extractPDFSafe(file){
    if(typeof pdfjsLib === 'undefined') throw new Error('pdf.js not loaded');
    try{
      const arr = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument(new Uint8Array(arr));
      const pdf = await loadingTask.promise;
      let out = '';
      for(let i=1;i<=pdf.numPages;i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(it=>it.str).join(' ');
        out += '\n'+pageText+'\n';
      }
      return out;
    }catch(e){
      throw new Error('PDF extraction failed: '+e.message);
    }
  }

  async function extractImageSafe(file){
    if(typeof Tesseract === 'undefined') throw new Error('Tesseract not loaded');
    try{
      const worker = Tesseract.createWorker({ logger: m => {
        // optional status updates
      }});
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();
      return text;
    }catch(e){
      throw new Error('OCR failed: '+e.message);
    }
  }

  /* ---------- Parsing logic (same as earlier version but defensive) ---------- */
  function normalizeLines(raw){
    if(!raw) return [];
    return raw.split(/\r?\n/).map(s=>s.replace(/\u00A0/g,' ').trim()).filter(Boolean).map(s=>s.replace(/\s{2,}/g,' ').trim());
  }
  function toNumber(s){ return Number(String(s||'').replace(/,/g,'')) || 0; }

  const ITEM_LINE_RE = /^(.+?)\s+(\d+)\s+([\d,]+\.\d{1,2})\s+([\d,]+\.\d{1,2})$/;

  function extractItems(lines){
    const items = [];
    for(const l of lines){
      const m = l.match(ITEM_LINE_RE);
      if(m){
        items.push({ description: m[1].trim(), qty: Number(m[2]), unit: toNumber(m[3]), total: toNumber(m[4]) });
      }
    }
    if(items.length) return items;
    // fallback heuristics: pick lines with rupee and short numbers
    for(const l of lines){
      if(/\b(total|subtotal|gst|sgst|cgst|tax|grand)\b/i.test(l)) continue;
      const ru = [...l.matchAll(/₹\s?([\d,]+(?:\.\d{1,2})?)/g)].map(x=>x[1]);
      if(ru.length){
        const total = toNumber(ru[ru.length-1]);
        const qtyMatch = l.match(/\b(\d{1,2})\b(?!.*\d{2,})/);
        const qty = qtyMatch ? Number(qtyMatch[1]) : 1;
        let desc = l.split(/₹/)[0].replace(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g,'').trim();
        if(!desc) desc = 'Item';
        const unit = qty>0 ? +(total/qty).toFixed(2) : total;
        items.push({ description: desc, qty, unit, total });
      }
    }
    return items;
  }

  function detectDate(text){
    if(!text) return '';
    const r1 = text.match(/\b([0-3]?\d[-\/\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-\/\s]\d{2,4})\b/i);
    if(r1) return r1[1];
    const r2 = text.match(/\b([0-3]?\d[\/\-][0-1]?\d[\/\-]\d{2,4})\b/);
    if(r2) return r2[1];
    const r3 = text.match(/\b(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})\b/);
    if(r3) return r3[1];
    const r4 = text.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i);
    if(r4) return r4[1];
    return '';
  }

  function detectTotals(lines){
    const totals = { subtotal:0, tax:0, gst:{}, grand:0, raw:[] };
    for(const l of lines){
      if(/\bsubtotal\b/i.test(l)){
        const m = l.match(/₹\s?([\d,]+(?:\.\d{1,2})?)/);
        if(m) totals.subtotal = toNumber(m[1]);
      }
      if(/grand\s*total/i.test(l) || /\btotal\s*amount\b/i.test(l) || /^total[:\s]/i.test(l)){
        const m = l.match(/₹\s?([\d,]+(?:\.\d{1,2})?)/);
        if(m) totals.grand = toNumber(m[1]);
      }
      if(/\b(GST|CGST|SGST|VAT|TAX)\b/i.test(l)){
        const m = l.match(/(CGST|SGST|GST|VAT)[^\d%]*(\d{1,2})%?.*₹\s?([\d,]+(?:\.\d{1,2})?)/i);
        if(m){ const key = (m[1]||'GST').toUpperCase(); totals.gst[key] = (totals.gst[key]||0)+toNumber(m[3]); totals.tax += toNumber(m[3]); }
        else { const mm = [...l.matchAll(/₹\s?([\d,]+(?:\.\d{1,2})?)/g)]; if(mm.length) totals.tax += toNumber(mm[mm.length-1][1]); }
      }
      const mm = [...l.matchAll(/₹\s?([\d,]+(?:\.\d{1,2})?)/g)].map(x=>x[1]);
      if(mm.length) totals.raw.push(...mm.map(toNumber));
    }
    if(!totals.grand && totals.raw.length) totals.grand = totals.raw[totals.raw.length-1];
    if(!totals.subtotal && totals.raw.length>1) totals.subtotal = totals.raw[totals.raw.length-2];
    return totals;
  }

  function detectMerchant(lines){
    for(const l of lines.slice(0,6)){
      if(l.length>3 && /[A-Z]/.test(l) && !/GST|INVOICE|TAX|DATE|PHONE|MOB|ADDRESS/i.test(l)){
        const ratioUpper = (l.replace(/[^A-Z]/g,'').length / Math.max(1,l.length));
        if(ratioUpper > 0.18 || /^[A-Z0-9 ]+$/.test(l)) return l;
      }
    }
    const joined = lines.join(' ');
    const brand = (joined.match(/\b(megamart|mart|dmart|big ?bazaar|store|supermarket|hyperstore|pharmacy|chemist)\b/i)||[])[0];
    return brand ? brand.toUpperCase() : (lines[0]||'Unknown Merchant');
  }

  async function parseRawTextSafe(raw){
    const lines = normalizeLines(raw);
    const joined = lines.join('\n');
    const merchant = detectMerchant(lines);
    const date = detectDate(joined);
    const totals = detectTotals(lines);
    const items = extractItems(lines);
    const paymentMode = (joined.match(/\b(Payment Mode|Mode of Payment)[:\s]*([A-Za-z0-9]+)/i)||[])[2] || ((joined.match(/\b(UPI|CARD|CASH|NETBANKING|PAYTM)\b/i)||[])[0] || '');
    const ref = (joined.match(/Ref(?:erence)?(?: ID| No|:)?\s*[:\-]?\s*([A-Za-z0-9@-]+)/i)||[])[1] || (joined.match(/\b[A-Z0-9]{6,}@[a-zA-Z]+/i)||[])[0] || '';
    const invoiceNo = (joined.match(/\b(?:Invoice|Inv|Bill|Receipt)[\s:]*([A-Za-z0-9\/\-]+)/i)||[])[1] || '';
    const category = (function(){ const t = joined.toLowerCase(); if(/grocery|mart|bread|vegetable|fruits|supermarket/.test(t)) return 'Groceries'; if(/hotel|restaurant|dine|cafe|coffee/.test(t)) return 'Dining'; if(/pharm|medical|chemist/.test(t)) return 'Health'; if(/fuel|petrol|diesel/.test(t)) return 'Fuel'; if(/electronics|mobile|charger|headphone/.test(t)) return 'Electronics'; return 'General'; })();
    return { merchant, date, totals, items, paymentMode, ref, invoiceNo, category, rawText: raw };
  }

  /* ---------- Render functions ---------- */
  function renderParsed(parsed){
    // show parsedCard if exists
    const parsedCard = $('parsedCard'); if(parsedCard) show(parsedCard);
    const meta = $('metaBlock'); if(meta) meta.innerHTML = `
      <div><strong>Merchant:</strong> ${safeText(parsed.merchant)}</div>
      <div><strong>Invoice:</strong> ${safeText(parsed.invoiceNo)} &nbsp; <strong>Date:</strong> ${safeText(parsed.date)}</div>
      <div><strong>Payment:</strong> ${safeText(parsed.paymentMode)} ${parsed.ref?('• Ref: '+safeText(parsed.ref)):''}</div>
      <div><strong>Category:</strong> ${safeText(parsed.category)}</div>
      <div style="margin-top:6px;color:#bfb3a2">Detected totals — Subtotal: ₹${fmt(parsed.totals.subtotal||0)}, Tax: ₹${fmt(parsed.totals.tax||0)}, Grand: ₹${fmt(parsed.totals.grand||0)}</div>
    `;
    const itemsBlock = $('itemsBlock');
    if(itemsBlock){
      if(!parsed.items || !parsed.items.length) { itemsBlock.innerHTML = '<div style="color:#bfb3a2">No item lines detected.</div>'; return; }
      let html = '<table class="itemsTable"><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>';
      parsed.items.forEach((it,i)=> html += `<tr><td>${i+1}</td><td>${safeText(it.description)}</td><td>${it.qty}</td><td>₹${fmt(it.unit)}</td><td>₹${fmt(it.total)}</td></tr>`);
      html += '</tbody></table>';
      itemsBlock.innerHTML = html;
    }
  }

  /* ---------- History (simple safe wrappers) ---------- */
  // reuse earlier IndexedDB helpers but minimal and safe
  const DBNAME = 'anj_invoice_v3_safe';
  const STORE = 'invoices';
  function openDB(){
    return new Promise((resolve,reject)=>{
      const r = indexedDB.open(DBNAME,1);
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{ keyPath:'id', autoIncrement:true });
      };
      r.onsuccess = e => resolve(e.target.result);
      r.onerror = e => reject(e.target.error);
    });
  }
  async function saveRec(rec){
    const db = await openDB();
    return new Promise((res,rej)=>{
      const tx = db.transaction(STORE,'readwrite');
      const s = tx.objectStore(STORE);
      const rq = s.add(rec);
      rq.onsuccess = e => res(e.target.result);
      rq.onerror = e => rej(e.target.error);
    });
  }
  async function loadHistorySafe(){
    try{
      const db = await openDB();
      return new Promise((res,rej)=>{
        const tx = db.transaction(STORE,'readonly');
        const s = tx.objectStore(STORE);
        const rq = s.getAll();
        rq.onsuccess = e => {
          const rows = e.target.result || [];
          const list = $('historyList');
          if(!list) return res(rows);
          list.innerHTML = '';
          if(!rows.length) { list.innerHTML = '<div class="muted">No saved bills yet.</div>'; return res(rows); }
          rows.sort((a,b)=> b.savedAt - a.savedAt);
          for(const r of rows){
            const div = document.createElement('div');
            div.className = 'historyItem';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.padding = '8px';
            div.style.borderRadius = '8px';
            div.style.marginBottom = '8px';
            div.innerHTML = `<div>
              <div style="font-weight:700">${safeText(r.merchant)}</div>
              <div style="font-size:12px;color:#bfb3a2">${new Date(r.savedAt).toLocaleString()}</div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn small ghost" onclick="(function(id){ return async function(){ alert('view not implemented in debug build: '+id); }} )(${JSON.stringify(r.id)})()">View</button>
              <button class="btn small ghost" onclick="(function(id){ return async function(){ if(confirm('Delete?')){ const db = await openDB(); const tx = db.transaction(STORE,'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = ()=> location.reload(); }} )(${JSON.stringify(r.id)})()">Delete</button>
            </div>`;
            list.appendChild(div);
          }
          res(rows);
        };
        rq.onerror = e => rej(e.target.error);
      });
    }catch(e){
      console.error('History load error', e);
      addMsg('History load error: '+e.message,'err');
      throw e;
    }
  }

  /* ---------- Save handler ---------- */
  async function onSaveClicked(){
    if(!window.__lastParsed) return alert('Nothing parsed yet.');
    try{
      const p = window.__lastParsed;
      const rec = {
        merchant: p.merchant||'Unknown',
        invoiceNo: p.invoiceNo||'',
        date: p.date||'',
        category: p.category||'General',
        totals: p.totals||{},
        items: p.items||[],
        rawText: p.rawText||'',
        savedAt: Date.now()
      };
      // attach file buffer if present
      if(p.fileBlob && typeof p.fileBlob.arrayBuffer === 'function'){
        try{ rec.fileBuffer = await p.fileBlob.arrayBuffer(); rec.fileType = p.fileBlob.type || ''; }catch(e){ console.warn('file buffer not saved', e); }
      }
      const id = await saveRec(rec);
      addMsg('Saved record id: '+id);
      await loadHistorySafe();
    }catch(e){ addMsg('Save error: '+(e.message||e), 'err'); }
  }

  /* ---------- Export All / Clear ---------- */
  async function onExportAll(){
    try{
      const db = await openDB();
      const tx = db.transaction(STORE,'readonly');
      const list = await new Promise((res,rej)=>{ const rq = tx.objectStore(STORE).getAll(); rq.onsuccess = e => res(e.target.result); rq.onerror = e => rej(e.target.error); });
      const blob = new Blob([JSON.stringify(list, null, 2)], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'anj-history.json'; a.click(); URL.revokeObjectURL(url);
      addMsg('Exported '+list.length+' records');
    }catch(e){ addMsg('Export failed: '+(e.message||e),'err'); }
  }
  async function onClearAll(){
    if(!confirm('Clear all saved history?')) return;
    t
