window.appInitialized = true;

(async function () {

    const fileInput = document.getElementById("fileInput");
    const parseBtn = document.getElementById("parseBtn");
    const ocrBtn = document.getElementById("ocrBtn");
    const saveBtn = document.getElementById("saveBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const printBtn = document.getElementById("printBtn");
    const historyList = document.getElementById("historyList");
    const extractedBox = document.getElementById("extractedBox");

    let extractedData = null;

    function safe(text) {
        return text.replace(/</g, "&lt;");
    }

    function extractAI(text) {
        const clean = text.replace(/\s+/g, " ").trim();

        const total = clean.match(/(?:total|amount|grand)\s*[:\-]?\s*₹?\s*([0-9]+(?:\.[0-9]+)?)/i);
        const date = clean.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
        const merchant = clean.match(/(?:store|mart|shop|market|bazaar)[:\- ]?([A-Za-z0-9 ]+)/i);

        return {
            date: date?.[1] ?? "-",
            total: total?.[1] ?? "-",
            merchant: merchant?.[1] ?? "Unknown",
            category: "General"
        };
    }

    async function readPDF(file) {
        const array = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: array }).promise;
        let text = "";

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(i => i.str).join(" ") + " ";
        }
        return text;
    }

    async function runOCR(file) {
        const { data } = await Tesseract.recognize(file, "eng");
        return data.text;
    }

    function renderOutput(data) {
        extractedBox.innerHTML = `
            <p><b>Date:</b> ${safe(data.date)}</p>
            <p><b>Total:</b> ₹${safe(data.total)}</p>
            <p><b>Merchant:</b> ${safe(data.merchant)}</p>
            <p><b>Category:</b> ${safe(data.category)}</p>
        `;
        document.getElementById("outputCard").style.display = "block";
    }

    parseBtn.onclick = async () => {
        const file = fileInput.files[0];
        if (!file) return alert("Please choose a file");

        let text = "";
        if (file.type.includes("pdf")) text = await readPDF(file);
        else text = await file.text();

        extractedData = extractAI(text);
        renderOutput(extractedData);
    };

    ocrBtn.onclick = async () => {
        const file = fileInput.files[0];
        if (!file) return alert("Choose image for OCR");

        const text = await runOCR(file);
        extractedData = extractAI(text);
        renderOutput(extractedData);
    };

    saveBtn.onclick = () => {
        if (!extractedData) return;
        const list = JSON.parse(localStorage.getItem("history") || "[]");
        list.push(extractedData);
        localStorage.setItem("history", JSON.stringify(list));
        loadHistory();
    };

    function loadHistory() {
        const list = JSON.parse(localStorage.getItem("history") || "[]");
        if (list.length === 0) {
            historyList.innerHTML = "No saved bills yet.";
            return;
        }
        historyList.innerHTML = list.map((e, i) =>
            `<p>#${i + 1} — ₹${e.total} — ${e.merchant} — ${e.date}</p>`
        ).join("");
    }

    downloadBtn.onclick = () => {
        window.print();
    };

    printBtn.onclick = () => {
        window.print();
    };

    loadHistory();

})();
  
