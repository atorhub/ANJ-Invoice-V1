/* script.js - ANJ Invoice V1 (Parser + Generator)
   - Supports PDF (pdf.js), Image OCR (Tesseract), TXT
   - Simple extraction + naive item detection
   - Generates A1 Black & Gold invoice HTML
*/

// ----- Helpers -----
function el(id){ return document.getElementById(id); }
function show(id){ el(id).classList.remove('hidden'); }
function hide(id){ el(id).classList.add('hidden'); }
function safeTrim(s){ return (s||'').toString().trim(); }

// ----- Main entry
async function processFile(){
  const f = el('fileInput').files[0];
  if(!f) return alert('Please choose a file first.');

  hide('finalInvoice');
  hide('parsedData');

  const type = f.type || f.name.split('.').pop().toLowerCase();

  try{
    if(type.includes('pdf') || /\.pdf$/i.test(f.name)){
      const txt = await extractPDF(f);
      showParsed(txt);
    } else if(type.includes('image') || /\.(jpe?g|png|bmp|webp)$/i.test(f.name)){
      const txt = await extractImage(f);
      showParsed(txt);
    } else if(type.includes('text') || /\.txt$/i.test(f.name)){
      const txt = await extractText(f);
      showParsed(txt);
    } else {
      alert('Unsupported file type. Use PDF, JPG, PNG or TXT.');
    }
  }catch(err){
    console.error('Parse error', err);
    alert('Error parsing file: '+ (err && err.message ? err.message : err));
  }
}

// ----- PDF extraction using pdf.js -----
async function extractPDF(file){
  // pdf.js expects typed array
  const arr = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument(new Uint8Array(arr)).promise;
  let out = '';
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(' ');
    out += `\n--- Page ${i} ---\n` + pageText + '\n';
  }
  return out;
}

// ----- Image OCR using Tesseract -----
async function extractImage(file){
  // show small progress (optional)
  const worker = Tesseract.createWorker({ logger: m => {
    // you can display progress: console.log(m);
  }});
  await worker.load();
  await worker.loadLanguage('eng');
  await worker.initialize('eng');

  const { data: { text } } = await worker.recognize(file);
  await worker.terminate();
  return text;
}

// ----- Plain text
async function extractText(file){
  return await file.text();
}

// ----- Show parsed result and basic parsing
function showParsed(text){
  text = safeTrim(text);
  el('parsedOutput').textContent = text || '[no text found]';
  show('parsedData');

  // Try to extract some fields
  const invoiceNo = (text.match(/INV[-\s:]?([A-Za-z0-9-]+)/i) || [])[0] || (text.match(/Invoice\s*No[:\s]*([A-Za-z0-9-]+)/i)||[])[0] || 'INV-0001';
  const date = (text.match(/\b(?:Date|DATE)[:\s]*([0-9]{1,2}[-\/][0-9]{1,2}[-\/][0-9]{2,4})/i) || text.match(/\b([0-9]{1,2}\s?[A-Za-z]{3}\s?[0-9]{4})/i) || []) [1] || '';
  const total = (text.match(/₹\s?[\d,]+(?:\.\d+)?/g) || []).slice(-1)[0] || (text.match(/\bTotal[:\s]*([\d,]+(?:\.\d+)?)/i)||[])[1] || '';

  // store small helper dataset for invoice generation
  window._anj_parsed = {
    raw: text,
    invoiceNo: invoiceNo,
    date: date || '',
    total: total || ''
  };
}

// ----- Generate the final A1 invoice HTML (Black & Gold) -----
function generateInvoice(){
  const data = window._anj_parsed || {};
  const raw = data.raw || el('parsedOutput').textContent || '';
  // Very naive items extraction (try to detect lines with qty or price)
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);

  // Simple attempt: lines that include a rupee symbol or numbers near end
  const items = [];
  for(let ln of lines){
    // pattern: Description ... qty ... price ... total
    const rupeeMatch = ln.match(/₹\s?([\d,]+(?:\.\d+)?)/);
    if(rupeeMatch){
      // split by multiple spaces and take first words as description
      const pieces = ln.split(/\s{2,}|\t| - | \| /).map(s=>s.trim()).filter(Boolean);
      // heuristics
      let desc = pieces[0];
      let qty = 1;
      let rate = rupeeMatch[1].replace(/,/g, '');
      let total = rate;
      // if there are multiple numbers, try to pick last as total
      const nums = ln.match(/[\d,]+\.\d+|[\d,]{1,}/g) || [];
      if(nums.length >= 2){
        // try assign qty from first small number
        const maybeQty = nums.find(n => parseInt(n.replace(/,/g,''))<100 && n.length<=3);
        if(maybeQty && !desc.match(/\b\d+\b/)) qty = parseInt(maybeQty.replace(/,/g,'')) || 1;
        total = nums[nums.length-1].replace(/,/g,'');
        rate = nums.length>1 ? nums[nums.length-2].replace(/,/g,'') : rate;
      }
      items.push({
        description: desc,
        qty: qty,
        rate: Number(rate),
        total: Number(total)
      });
    }
  }

  // Fallback: if no items, create one with detected total
  if(items.length===0){
    const totalFound = (raw.match(/₹\s?([\d,]+(?:\.\d+)?)/g)||[]).slice(-1)[0] || data.total || '';
    let tnum = totalFound ? Number(totalFound.replace(/[₹,\s]/g,'')) : 0;
    items.push({ description: 'Bill Amount', qty:1, rate: tnum, total: tnum });
  }

  // build invoice HTML
  const invoiceNo = data.invoiceNo || 'INV-0001';
  const date = data.date || (new Date()).toLocaleDateString();
  const company = { name: 'ANJ BUSINESS INVOICE', addr: 'ANJ Creator Hub • Bengaluru' };

  // totals
  const subtotal = items.reduce((s,i)=> s + (i.total|| (i.qty*i.rate)), 0);
  const tax = +(subtotal * 0.05).toFixed(2);
  const grand = +(subtotal + tax).toFixed(2);

  const rows = items.map((it, idx) => `
    <tr>
      <td style="width:6%">${idx+1}</td>
      <td>${escapeHtml(it.description)}</td>
      <td style="width:10%" class="right">${it.qty}</td>
      <td style="width:16%" class="right">₹${numberWithCommas(it.rate.toFixed(2))}</td>
      <td style="width:18%" class="right">₹${numberWithCommas(it.total.toFixed(2))}</td>
    </tr>
  `).join('\n');

  const html = `
    <div class="invoiceBox">
      <div class="invoiceTop">
        <div class="brand">
          <span class="diamond"></span>
          <div>
            <div class="invTitle">${company.name}</div>
            <div class="small">${company.addr}</div>
          </div>
        </div>
        <div class="invoiceMeta">
          <div class="metaStrong">Invoice No: ${invoiceNo}</div>
          <div class="small">Date: ${date}</div>
        </div>
      </div>

      <div class="tableWrap">
        <table class="invoiceTable" role="table">
          <thead>
            <tr><th style="width:6%">#</th><th>Description</th><th>Qty</th><th>Unit Price</th><th class="right">Total</th></tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>

      <div class="totals">
        <div class="totalsBox">
          <p><span>Subtotal:</span> <span>₹${numberWithCommas(subtotal.toFixed(2))}</span></p>
          <p><span>Tax (5%):</span> <span>₹${numberWithCommas(tax.toFixed(2))}</span></p>
          <p class="grand"><span>Grand Total:</span> <strong>₹${numberWithCommas(grand.toFixed(2))}</strong></p>
        </div>
      </div>

      <div style="margin-top:12px; font-size:13px; color:var(--subtle);">Thank you for your business. Generated by ANJ Invoice V1.</div>
    </div>
  `;

  el('invoiceArea').innerHTML = html;
  show('finalInvoice');
  // scroll to invoice
  setTimeout(()=> window.scrollTo({ top: document.body.scrollHeight, behavior:'smooth' }), 200);
}

// ----- small helpers -----
function numberWithCommas(x){ return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function escapeHtml(str){
  if(!str) return '';
  return str.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
      }
