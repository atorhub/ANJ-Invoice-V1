// Option-D Hybrid Parser app.js
// defensive init flag
window.appInitialized = true;

(function () {
  // DOM refs
  const fileInput = document.getElementById("fileInput");
  const parseBtn = document.getElementById("parseBtn");
  const ocrBtn = document.getElementById("ocrBtn");
  const saveBtn = document.getElementById("saveBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const printBtn = document.getElementById("printBtn");
  const historyList = document.getElementById("historyList");
  const extractedBox = document.getElementById("extractedBox");
  const outputCard = document.getElementById("outputCard");
  const exportAllBtn = document.getElementById("exportAllBtn");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  const chartCanvas = document.getElementById("chartCanvas");

  // small helpers
  function el(id){return document.getElementById(id)}
  function qs(sel){return document.querySelector(sel)}
  function safe(s){ if(s==null) return ""; return String(s).replace(/</g,"&lt;") }

  // -------------------------
  // Parsing utilities
  // -------------------------
  function normalizeText(raw){
    // keep lines but normalize spacing and remove unusual control chars
    raw = raw.replace(/\r\n/g,"\n").replace(/\r/g,"\n");
    // remove weird Unicode
    raw = raw.replace(/\u00A0/g," ");
    return raw.replace(/\t/g," ").replace(/[ \f\v]+/g," ").trim();
  }

  function findTotal(raw){
    // Try many patterns in priority order
    const patterns = [
      /GRAND\s+TOTAL[:\s]*₹?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      /TOTAL\s+AMOUNT[:\s]*₹?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      /AMOUNT\s+PAID[:\s]*₹?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      /NET\s+PAYABLE[:\s]*₹?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      /TOTAL[:\s]*₹?\s*([0-9,]+(?:\.[0-9]{1,2})?)(?!\s*INR)/i,
      /AMOUNT[:\s]*₹?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      /₹\s?([0-9,]+(?:\.[0-9]{1,2})?)(?=\s*(?:TOTAL|GRAND|AMOUNT))/i
    ];
    for (const p of patterns){
      const m = raw.match(p);
      if(m && m[1]) return m[1].replace(/,/g,"");
    }

    // fallback: get largest monetary value found (common trick)
    const all = [...raw.matchAll(/₹?\s?([0-9]{1,3}(?:[0-9,]*)(?:\.[0-9]{1,2})?)/g)];
    if(all.length){
      // pick max number
      let max = 0; let val = null;
      for(const a of all){
        const n = Number(a[1].replace(/,/g,""));
        if(!isNaN(n) && n >= max){ max = n; val = n }
      }
      if(val !== null) return String(val);
    }
    return "-";
  }

  function findDate(raw){
    // many common date patterns
    const p = raw.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
    if(p) return p[1];
    const months = "(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)";
    const p2 = raw.match(new RegExp("\\b(\\d{1,2}\\s+"+months+"\\s+\\d{2,4})\\b","i"));
    if(p2) return p2[1];
    const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if(iso) return iso[1];
    return "-";
  }

  function findMerchant(raw){
    // look line by line for merchant-like words
    const keywords = ["STORE","MART","SUPERMARKET","HYPER","MARKET","SHOP","BAZAAR","GROCERY","MALL","HYPERSTORE"];
    const lines = raw.split(/\n/).map(l=>l.trim()).filter(Boolean);
    // preference: lines that include keywords and are longer (likely merchant header)
    const matches = lines.filter(l => keywords.some(k => l.toUpperCase().includes(k)));
    if(matches.length){
      // longest match
      return matches.sort((a,b)=>b.length-a.length)[0];
    }
    // fallback: first non-numeric uppercase-ish line (title)
    for(const l of lines){
      if(/[A-Za-z]/.test(l) && l.length>3 && !/^[0-9\-\s\:\.]+$/.test(l)){
        // likely merchant
        return l;
      }
    }
    return "Unknown";
  }

  // items extraction (best-effort)
  function extractItems(raw){
    // naive item-line detection: lines with qty and price or price at end
    const lines = raw.split("\n").map(l=>l.trim());
    const items = [];
    for(const l of lines){
      // skip headers and totals
      if(/total|sub ?total|tax|invoice|gst|amount/i.test(l)) continue;
      // look for patterns like: "NAME 2  299  598"
      const parts = l.split(/\s{2,}|\t/).map(p=>p.trim()).filter(Boolean);
      if(parts.length>=2 && /[0-9]/.test(parts[parts.length-1])){
        // last token numeric -> price
        const priceToken = parts[parts.length-1].replace(/₹|,/g,"");
        const qtyToken = parts.length>=3 ? parts[parts.length-2] : "1";
        const name = parts.slice(0, parts.length-2).join(" ") || parts[0];
        const price = Number(priceToken) || null;
        const qty = Number(qtyToken) || 1;
        if(price) items.push({name,qty,price});
      } else {
        // fallback: lines containing price with ₹
        const m = l.match(/(.+?)\s+₹\s*([0-9,]+(?:\.[0-9]{1,2})?)/);
        if(m){ items.push({name:m[1].trim(), qty:1, price: Number(m[2].replace(/,/g,""))}) }
      }
    }
    return items;
  }

  // --------------------------------
  // PDF & OCR functions
  // --------------------------------
  async function readPDFText(file){
    try{
      const array = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({data:array}).promise;
      let full = "";
      for(let i=1;i<=pdf.numPages;i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(it=>it.str).join(" ");
        full += pageText + "\n";
      }
      return full;
    }catch(err){
      console.error("pdf read error",err);
      throw err;
    }
  }

  async function runOCR(file){
    try{
      const result = await Tesseract.recognize(file, 'eng', {logger: m => {/*quiet*/}});
      return result.data.text || "";
    }catch(err){
      console.error("ocr error",err);
      throw err;
    }
  }

  // --------------------------------
  // UI helpers
  // --------------------------------
  function showOutput(parsed){
    outputCard.classList.remove("hidden");
    extractedBox.innerHTML = `
      <p><strong>Date:</strong> ${safe(parsed.date)}</p>
      <p><strong>Total:</strong> ₹${safe(parsed.total)}</p>
      <p><strong>Merchant:</strong> ${safe(parsed.merchant)}</p>
      <p><strong>Category:</strong> ${safe(parsed.category || "General")}</p>
      <div style="margin-top:8px;color:var(--muted);font-size:13px;">
        <strong>Items (best-effort):</strong>
        <div>${(parsed.items && parsed.items.length) ? parsed.items.map(it=>`<div>${safe(it.name)} — ${it.qty} × ₹${it.price}</div>`).join("") : "<div>None detected</div>"}</div>
      </div>
    `;
  }

  // --------------------------------
  // App / history
  // --------------------------------
  function loadHistory(){
    const list = JSON.parse(localStorage.getItem("anj_history_v2")||"[]");
    if(!list.length) { historyList.innerHTML = "No saved bills yet."; return; }
    historyList.innerHTML = list.map((e,i)=>`<div style="padding:8px 0;border-bottom:1px solid #111">${i+1}. <b>₹${safe(e.total)}</b> — ${safe(e.merchant)} — ${safe(e.date)}</div>`).join("");
    updateAnalytics(list);
  }

  function saveToHistory(parsed){
    if(!parsed) return alert("No parsed data to save");
    const list = JSON.parse(localStorage.getItem("anj_history_v2")||"[]");
    list.unshift(parsed); // newest first
    localStorage.setItem("anj_history_v2", JSON.stringify(list));
    loadHistory();
    alert("Saved to history");
  }

  function clearHistory(){
    if(!confirm("Clear all saved history?")) return;
    localStorage.removeItem("anj_history_v2");
    loadHistory();
  }

  function exportAllJSON(){
    const list = JSON.parse(localStorage.getItem("anj_history_v2")||"[]");
    const blob = new Blob([JSON.stringify(list, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "anj_invoice_history.json"; a.click();
    URL.revokeObjectURL(url);
  }

  // analytics base (very simple)
  function updateAnalytics(list){
    try{
      if(!list || !list.length) return;
      // category totals
      const cat = {};
      list.forEach(it => {
        const c = it.category || "General";
        cat[c] = (cat[c]||0) + Number(it.total || 0);
      });
      // draw a simple chart via canvas
      const labels = Object.keys(cat);
      const values = labels.map(l => cat[l]);
      // simple chart: draw bars on canvas
      const c = chartCanvas;
      if(!c) return;
      const ctx = c.getContext("2d");
      c.width = Math.min(window.innerWidth - 40, 720);
      c.height = 160;
      ctx.clearRect(0,0,c.width,c.height);
      const max = Math.max(...values,1);
      const barW = Math.floor(c.width / labels.length) - 12;
      labels.forEach((lab, idx) => {
        const h = Math.round((values[idx]/max) * (c.height-30));
        const x = 10 + idx*(barW+12);
        ctx.fillStyle = "#d09b1e";
        ctx.fillRect(x, c.height-20-h, barW, h);
        ctx.fillStyle = "#fff";
        ctx.font = "11px Arial";
        ctx.fillText(lab, x, c.height-4);
      });
    }catch(e){
      console.warn("analytics error", e);
    }
  }

  // --------------------------------
  // Master parse pipeline (hybrid)
  // --------------------------------
  async function parseFileAsText(file){
    if(!file) throw new Error("No file");
    const mime = file.type || "";
    try{
      if(mime.includes("pdf")) {
        return await readPDFText(file);
      } else if(mime.startsWith("image/")){
        // try OCR path by default for images
        return await runOCR(file);
      } else if(mime.includes("text") || /\.txt$/i.test(file.name)){
        return await file.text();
      } else {
        // fallback: try text() then OCR if small
        try { return await file.text(); } catch(e){ return await runOCR(file); }
      }
    }catch(err){
      // fallback OCR if pdf text empty
      try{
        return await runOCR(file);
      }catch(e){
        throw err;
      }
    }
  }

  function scoreCategoryByKeywords(text){
    const mapping = {
      "Groceries": ["GROCERY","VEGETABLE","FRUITS","DAIRY","MILK","EGG","BREAD"],
      "Travel": ["TAXI","UBER","OYO","HOTEL","RAILWAY","AIRLINE"],
      "Health": ["PHARMA","MEDICINE","HOSPITAL","CLINIC"],
      "Restaurants": ["RESTAURANT","CAFE","FOOD","MEAL"],
      "Fuel": ["PETROL","DIESEL","FUEL","BPCL","IOC"],
    };
    const t = text.toUpperCase();
    for(const k in mapping){
      if(mapping[k].some(kw=>t.includes(kw))) return k;
    }
    return "General";
  }

  async function hybridParse(file){
    const raw = await parseFileAsText(file);
    const normalized = normalizeText(raw);
    const date = findDate(normalized);
    const total = findTotal(normalized);
    const merchant = findMerchant(normalized);
    const items = extractItems(normalized);
    const category = scoreCategoryByKeywords(normalized);
    return { date, total, merchant, items, category, rawPreview: normalized.slice(0,200) };
  }

  // --------------------------------
  // Download invoice as PDF (render current output)
  // --------------------------------
  async function downloadOutputAsPDF(){
    // capture the outputCard (if visible), or entire main
    const target = outputCard || document.querySelector("main");
    await html2canvas(target, {scale:1.2, useCORS:true});
    const canvas = await html2canvas(target, {scale:1.4, useCORS:true});
    const imgData = canvas.toDataURL("image/jpeg",0.95);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit:"px", format:[canvas.width, canvas.height] });
    pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
    pdf.save("anj_invoice_parsed.pdf");
  }

  // --------------------------------
  // Events wiring
  // --------------------------------
  let lastParsed = null;

  parseBtn.addEventListener("click", async ()=>{
    const f = fileInput.files[0];
    if(!f) return alert("Choose a file first");
    parseBtn.disabled = true;
    parseBtn.textContent = "Parsing...";
    try{
      const parsed = await hybridParse(f);
      lastParsed = parsed;
      showOutput(parsed);
    }catch(e){
      console.error("parse failed", e);
      alert("Parse failed: " + (e.message||e));
    }finally{
      parseBtn.disabled = false;
      parseBtn.textContent = "Parse Bill";
    }
  });

  ocrBtn.addEventListener("click", async ()=>{
    const f = fileInput.files[0];
    if(!f) return alert("Choose an image file first");
    ocrBtn.disabled = true; ocrBtn.textContent = "OCR...";
    try{
      const text = await runOCR(f);
      const parsed = { date: findDate(text), total: findTotal(text), merchant: findMerchant(text), items: extractItems(text), category: scoreCategoryByKeywords(text), rawPreview: text.slice(0,200) };
      lastParsed = parsed;
      showOutput(parsed);
    }catch(e){
      console.error("ocr failed", e);
      alert("OCR failed");
    }finally{
      ocrBtn.disabled = false; ocrBtn.textContent = "OCR (image)";
    }
  });

  saveBtn.addEventListener("click", ()=>{
    if(!lastParsed) return alert("Nothing to save — parse first");
    saveToHistory(lastParsed);
  });

  downloadBtn.addEventListener("click", async ()=>{
    if(!lastParsed) return alert("Parse first to download invoice");
    // show output card then generate pdf of it
    await downloadOutputAsPDF();
  });

  printBtn.addEventListener("click", ()=>{
    if(!lastParsed) return alert("Parse first to print");
    window.print();
  });

  exportAllBtn.addEventListener("click", exportAllJSON);
  clearHistoryBtn.addEventListener("click", clearHistory);

  // initial load
  loadHistory();

  // expose for debug in console if needed
  window.ANJ = {
    hybridParse, readPDFText, runOCR, findTotal, findDate, findMerchant
  };

})();
          
