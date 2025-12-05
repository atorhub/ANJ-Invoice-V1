/* script.js — ANJ Invoice V2
   Features:
   - PDF (pdf.js) / Image OCR (Tesseract) / TXT reading
   - AI-like heuristic extractor for merchant, date, invoice number, items, totals
   - IndexedDB history: save original file (blob), parsed text, structured items, generated invoice HTML
   - Load / View / Delete history, Export JSON
   - Generate BlackGold invoice HTML
*/

// ---------- IndexedDB wrapper (simple, promise-based) ----------
const DB_NAME = 'anj_invoice_db_v2';
const STORE = 'invoices';
function openDB(){
  return new Promise((res, rej)=>{
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath:'id', autoIncrement:true });
      }
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
}
async function saveToDB(record){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.add(record);
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}
async function getAllFromDB(){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}
async function deleteFromDB(id){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.delete(id);
    req.onsuccess = () => res(true);
    req.onerror = e => rej(e.target.error);
  });
}
async function clearDB(){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.clear();
    req.onsuccess = () => res(true);
    req.onerror = e => rej(e.target.error);
  });
}

// ---------- DOM utils ----------
const $ = id => document.getElementById(id);
function show(id){ const el = typeof id==='string' ? $(id) : id; el && el.classList.remove('hidden'); }
function hide(id){ const el = typeof id==='string' ? $(id) : id; el && el.classList.add('hidden'); }
function fmtDate(d){ return new Date(d).toLocaleString(); }

// ---------- File processing (PDF / IMG / TXT) ----------
async function processFile(){
  const f = $('fileInput').files[0];
  if(!f) return alert('Choose a file first.');
  hide('invoiceCard'); hide('parsedCard');

  try{
    let text = '';
    if(/\.pdf$/i.test(f.name) || f.type.includes('pdf')){
      text = await extractPDF(f);
    } else if(f.type.match(/image\//) || /\.(jpe?g|png|webp|bmp)$/i.test(f.name)){
      text = await extractImage(f);
    } else {
      text = await f.text();
    }
    handleParsedText(text, f);
  } catch(err){
    console.error(err);
    alert('Error parsing file: '+ (err.message||err));
  }
}

// pdf.js extraction
async function extractPDF(file){
  const arr = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument(new Uint8Array(arr));
  const pdf = await loadingTask.promise;
  let txt = '';
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    txt += content.items.map(it => it.str).join(' ') + '\n';
  }
  return txt;
}

// tesseract image OCR
async function extractImage(file){
  const worker = Tesseract.createWorker();
  await worker.load();
  await worker.loadLanguage('eng');
  await worker.initialize('eng');
  const { data: { text } } = await worker.recognize(file);
  await worker.terminate();
  return text;
}

// ---------- AI-like heuristic extractor ----------
function handleParsedText(rawText, originalFile){
  const text = (rawText||'').replace(/\r/g,'\n').split(/\n/).map(s=>s.trim()).filter(Boolean).join('\n');
  $('parsedOutput').textContent = text;
  show('parsedCard');

  // heuristic extraction
  const merchant = extractMerchant(text);
  const invoiceNo = extractInvoiceNo(text);
  const date = extractDate(text);
  const totals = extractTotals(text);
  const items = extractItems(text);

  window._current = {
    rawText: text,
    merchant, invoiceNo, date,
    items, totals,
    fileName: originalFile?.name || '',
    fileBlob: originalFile ? originalFile : null,
    savedAt: Date.now()
  };

  renderParsedMeta(window._current);
}

// merchant detection (very naive — tries header lines)
function extractMerchant(text){
  const lines = text.split('\n').slice(0,6);
  // pick first line with letters and spaces >3 chars
  for(let line of lines){
    if(/^[A-Z0-9&\-\.\s]{3,}$/i.test(line) && !/invoice|gst|tax|bill/i.test(line)){
      return line;
    }
  }
  // fallback find lines with 'store' or 'mart'
  const m = text.match(/([A-Z][A-Za-z0-9 &]{2,40}(?:mart|store|supermarket|hyperstore|shop|bakery|restaurant))/i);
  return m ? m[0] : 'Unknown Merchant';
}

// invoice number detection
function extractInvoiceNo(text){
  const m = text.match(/\b(INV|Invoice|Invoice No|Bill No|Receipt No)[\s:\-]*([A-Za-z0-9\-\/]+)/i);
  return m ? (m[2] || m[1]) : '';
}

// date detection
function extractDate(text){
  const m = text.match(/\b(?:Date|DATE|Dated)[:\s]*([0-9]{1,2}[\/\-\s][0-9]{1,2}[\/\-\s][0-9]{2,4})/i)
         || text.match(/\b([0-9]{1,2}\s?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s?[0-9]{4})/i);
  return m ? m[1] : '';
}

// totals detection
function extractTotals(text){
  // find Rs/₹ amounts, pick last few
  const all = [...text.matchAll(/₹\s?([\d,]+(?:\.\d+)?)/g)].map(m=>m[0]);
  const numbers = all.map(s=> Number(s.replace(/[₹,\s]/g,'')));
  const grand = numbers.length ? numbers[numbers.length-1] : 0;
  const subtotal = numbers.length>1 ? numbers[numbers.length-2] : grand;
  return { subtotal, grand, raw: all };
}

// items detection (AI-like heuristics)
// Strategy: take each line; lines that contain a rupee amount are likely item or totals; attempt to parse qty and price
function extractItems(text){
  const lines = text.split('\n');
  const items = [];
  for(let ln of lines){
    // skip lines that look like totals
    if(/subtotal|total|grand|gst|cgst|sgst|tax|amount paid|balance/i.test(ln)) continue;

    // if line has rupee
    const rupee = ln.match(/₹\s?([\d,]+(?:\.\d+)?)/);
    if(rupee){
      // find numbers (qty or price)
      const nums = ln.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g) || [];
      // heuristics for qty: a small integer <100 and appears before currency
      let qty = 1;
      for(let n of nums){
        const raw = Number(n.replace(/,/g,''));
        if(Number.isInteger(raw) && raw>0 && raw<100 && ln.indexOf(n) < ln.indexOf(rupee[0])){ qty = raw; break; }
      }
      // description: text before first number or before currency
      const desc = ln.split(/₹/)[0].replace(/\d{1,3}(?:,\d{3})*(?:\.\d+)?/g,'').trim().replace(/[-:]/g,'').trim();
      const amount = Number(rupee[1].replace(/,/g,''));
      // rate inference: if qty>1, rate = amount / qty
      const rate = qty>1 ? +(amount/qty).toFixed(2) : amount;
      items.push({ description: desc || 'Item', qty, rate, total: amount });
    }
  }
  // If we have no items, attempt fallback: detect lines with product-like words (very small list)
  if(items.length===0){
    const fallback = text.match(/(Tropicana|Amul|Aashirvaad|Paneer|Maggi|Coca-Cola|Bisleri|Cadbury|Pepsi|Eggs|Milk|Bread|Chicken|Toor Dal|Lays|Detergent|Colgate|Shampoo)/ig);
    if(fallback){
      fallback.forEach(f => items.push({ description: f, qty:1, rate:0, total:0 }));
    }
  }
  return items;
}

// ---------- Render parsed meta ----------
function renderParsedMeta(data){
  const meta = document.createElement('div');
  meta.innerHTML = `
    <div><strong>Merchant:</strong> ${escapeHtml(data.merchant || '')}</div>
    <div><strong>Invoice:</strong> ${escapeHtml(data.invoiceNo || '')} &nbsp; <strong>Date:</strong> ${escapeHtml(data.date || '')}</div>
    <div><strong>Detected total:</strong> ₹${numberWithCommas((data.totals?.grand||0).toFixed(2))}</div>
  `;
  const container = $('parsedMeta');
  container.innerHTML = '';
  container.appendChild(meta);

  // show items summary
  if(data.items && data.items.length){
    const table = document.createElement('div');
    table.innerHTML = '<strong>Items detected:</strong>';
    const t = document.createElement('table');
    t.className = 'invoiceTable';
    t.innerHTML = `<thead><tr><th>#</th><th>Description</th><th>Qty</th><th class="right">Total</th></tr></thead>`;
    const body = document.createElement('tbody');
    data.items.forEach((it,i)=> {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(it.description)}</td><td>${it.qty}</td><td class="right">₹${numberWithCommas((it.total||0).toFixed(2))}</td>`;
      body.appendChild(tr);
    });
    t.appendChild(body);
    container.appendChild(t);
  }

  show('parsedCard');
}

// ---------- Generate invoice HTML ----------
function generateInvoice(){
  const d = window._current;
  if(!d) return alert('No parsed data. Parse a bill first.');
  const items = d.items || [];
  const subtotal = items.reduce((s,it)=> s + (it.total|| (it.qty*it.rate || 0)), 0);
  const tax = +(subtotal * 0.05).toFixed(2);
  const grand = +(subtotal + tax).toFixed(2);

  const rows = items.map((it,idx)=>`
    <tr>
      <td style="width:6%">${idx+1}</td>
      <td>${escapeHtml(it.description)}</td>
      <td style="width:10%" class="right">${it.qty}</td>
      <td style="width:16%" class="right">₹${numberWithCommas((it.rate||0).toFixed(2))}</td>
      <td style="width:18%" class="right">₹${numberWithCommas((it.total||0).toFixed(2))}</td>
    </tr>
  `).join('');

  const html = `
    <div class="invoiceBox">
      <div class="invoiceTop">
        <div class="brand">
          <span class="diamond"></span>
          <div>
            <div class="invTitle">${escapeHtml(d.merchant || 'ANJ BUSINESS INVOICE')}</div>
            <div class="small">${escapeHtml(d.fileName || '')}</div>
          </div>
        </div>
        <div class="invoiceMeta">
          <div class="metaStrong">Invoice: ${escapeHtml(d.invoiceNo || '')}</div>
          <div class="small">Date: ${escapeHtml(d.date || (new Date()).toLocaleDateString())}</div>
        </div>
      </div>

      <div class="tableWrap">
        <table class="invoiceTable" role="table">
          <thead>
            <tr><th style="width:6%">#</th><th>Description</th><th>Qty</th><th>Unit Price</th><th class="right">Total</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="totals">
        <div class="totalsBox">
          <p><span>Subtotal:</span> <span>₹${numberWithCommas(subtotal.toFixed(2))}</span></p>
          <p><span>Tax (5%):</span> <span>₹${numberWithCommas(tax.toFixed(2))}</span></p>
          <p class="grand"><span>Grand Total:</span> <strong>₹${numberWithCommas(grand.toFixed(2))}</strong></p>
        </div>
      </div>

      <div style="margin-top:12px; font-size:13px; color:var(--muted);">Thank you for your business. Generated by ANJ Invoice V2.</div>
    </div>
  `;

  $('invoiceArea').innerHTML = html;
  show('invoiceCard');

  // attach generated invoice HTML to current object for saving
  window._current.generatedHtml = html;
  window._current.calculated = { subtotal, tax, grand };
}

// ---------- Save current parsed bill to IDB ----------
async function saveCurrent(withHtml = false){
  if(!window._current) return alert('Nothing to save yet.');
  const record = {
    merchant: window._current.merchant || '',
    invoiceNo: window._current.invoiceNo || '',
    date: window._current.date || '',
    fileName: window._current.fileName || '',
    parsedAt: Date.now(),
    rawText: window._current.rawText || '',
    items: window._current.items || [],
    totals: window._current.totals || {},
    generatedHtml: withHtml ? window._current.generatedHtml || '' : '',
  };

  // if original file Blob exists, store as ArrayBuffer to IDB
  if(window._current.fileBlob){
    try{
      const ab = await window._current.fileBlob.arrayBuffer();
      record.fileBuffer = ab; // IDB will store as binary
      record.fileType = window._current.fileBlob.type || '';
    }catch(e){ console.warn('can't store original file', e); }
  }

  const id = await saveToDB(record);
  alert('Saved to history (id:'+id+')');
  loadHistory();
}

// ---------- History UI ----------
async function loadHistory(){
  const all = await getAllFromDB();
  const container = $('historyList');
  container.innerHTML = '';
  if(!all.length){
    container.innerHTML = '<div class="muted small">No saved bills yet.</div>';
    return;
  }
  all.sort((a,b)=>b.parsedAt - a.parsedAt);
  for(const rec of all){
    const div = document.createElement('div');
    div.className = 'historyItem';
    div.innerHTML = `
      <div class="h-left">
        <div style="width:48px;height:40px;border-radius:8px;background:linear-gradient(135deg,#2a2a2a,#111);display:flex;align-items:center;justify-content:center;">
          <span style="color:${rec.generatedHtml?'#ffd973':'#bfb3a2'};font-weight:800;">${(rec.merchant||'ANJ').slice(0,2).toUpperCase()}</span>
        </div>
        <div>
          <div style="font-weight:700">${escapeHtml(rec.merchant || 'Unknown')}</div>
          <div class="h-meta">${escapeHtml(rec.fileName || '')} • ${fmtDate(rec.parsedAt)}</div>
        </div>
      </div>
      <div class="h-actions">
        <button class="btn small ghost" onclick="viewHistory(${rec.id})">View</button>
        <button class="btn small ghost" onclick="downloadJSON(${rec.id})">JSON</button>
        <button class="btn small ghost" onclick="deleteHistory(${rec.id})">Delete</button>
      </div>
    `;
    container.appendChild(div);
  }
}

// view a saved record
async function viewHistory(id){
  const all = await getAllFromDB();
  const rec = all.find(r=>r.id===id);
  if(!rec) return alert('Record not found');
  // show parsed card
  $('parsedOutput').textContent = rec.rawText || '';
  $('parsedMeta').innerHTML = `<div><strong>Merchant:</strong> ${escapeHtml(rec.merchant || '')}</div>
    <div><strong>Invoice:</strong> ${escapeHtml(rec.invoiceNo || '')} &nbsp; <strong>Date:</strong> ${escapeHtml(rec.date || '')}</div>
    <div><strong>Saved:</strong> ${fmtDate(rec.parsedAt)}</div>`;
  show('parsedCard');

  // set current to this rec for regenerate/save
  window._current = {
    ...rec,
    fileBlob: rec.fileBuffer ? new Blob([rec.fileBuffer], { type: rec.fileType || 'application/octet-stream' }) : null
  };
  // if generatedHtml exists, show invoice
  if(rec.generatedHtml){
    $('invoiceArea').innerHTML = rec.generatedHtml;
    show('invoiceCard');
  } else hide('invoiceCard');
  // scroll
  window.scrollTo({ top:0, behavior:'smooth' });
}

// delete history item
async function deleteHistory(id){
  if(!confirm('Delete this saved bill?')) return;
  await deleteFromDB(id);
  await loadHistory();
}

// clear history confirm
function clearHistoryConfirm(){
  if(!confirm('Clear all saved history? This cannot be undone.')) return;
  clearDB().then(()=> loadHistory());
}

// export single record as JSON
async function downloadJSON(id){
  const all = await getAllFromDB();
  const rec = all.find(r=>r.id===id);
  if(!rec) return alert('Not found');
  const blob = new Blob([JSON.stringify(rec, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `anj-invoice-${id}.json`; a.click(); URL.revokeObjectURL(url);
}

// export all
async function exportAllJSON(){
  const all = await getAllFromDB();
  const blob = new Blob([JSON.stringify(all, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `anj-invoice-history.json`; a.click(); URL.revokeObjectURL(url);
}

// ---------- Download invoice as PDF using print() (simple) ----------
function downloadInvoicePDF(){
  // open print dialog — browser will print page
  window.print();
}

// ---------- small helpers ----------
function numberWithCommas(x){ return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function escapeHtml(str){ if(!str) return ''; return str.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ---------- init ----------
window.addEventListener('DOMContentLoaded', ()=>{
  loadHistory();
});
