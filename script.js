// ======= GLOBAL =======
let db;
const DB_NAME = "anj_expense_ai_db";
const STORE_NAME = "history";

// ======= INDEXEDDB INIT =======
const request = indexedDB.open(DB_NAME, 3);

request.onupgradeneeded = function (e) {
    const dbObj = e.target.result;
    if (!dbObj.objectStoreNames.contains(STORE_NAME)) {
        dbObj.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
    }
};

request.onsuccess = function (e) {
    db = e.target.result;
    loadHistory();
};

// ======= FILE EXTRACTION =======
document.getElementById("extractBtn").addEventListener("click", async () => {
    const file = document.getElementById("fileInput").files[0];
    if (!file) return alert("Please upload a file!");

    let text = "";

    if (file.type === "application/pdf") {
        text = await extractPDF(file);
    } else {
        text = await extractImage(file);
    }

    processExtractedText(text);
});

// ======= PDF EXTRACT =======
async function extractPDF(file) {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let finalText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map(i => i.str).join(" ");
        finalText += strings + "\n";
    }
    return finalText;
}

// ======= IMAGE OCR =======
async function extractImage(file) {
    const result = await Tesseract.recognize(file, "eng");
    return result.data.text;
}

// ======= AI-LIKE PARSER =======
function processExtractedText(text) {
    console.log("RAW TEXT:", text);

    // DATE
    const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/;
    const date = text.match(dateRegex)?.[0] ?? "-";

    // TOTAL
    const totalRegex = /(?:Total|Amount|Grand)[^\d]{0,6}(\d+[\.\d]*)/i;
    const total = totalRegex.test(text)
        ? totalRegex.exec(text)[1]
        : "0";

    // MERCHANT
    const merchantRegex = /(Supermarket|Store|Mart|Bazaar|Hotel|Restaurant|Apple|Amazon|Flipkart|Zara|DMart|Reliance)/i;
    const merchant = merchantRegex.test(text)
        ? merchantRegex.exec(text)[0]
        : "Unknown";

    // CATEGORY AUTO-TAG
    const category = autoTag(text);

    document.getElementById("dateOut").innerText = date;
    document.getElementById("totalOut").innerText = total;
    document.getElementById("merchantOut").innerText = merchant;
    document.getElementById("categoryOut").innerText = category;

}

// ======= CATEGORY AI RULES =======
function autoTag(text) {
    text = text.toLowerCase();

    if (text.includes("grocery") || text.includes("mart") || text.includes("supermarket"))
        return "Groceries";

    if (text.includes("uber") || text.includes("ola") || text.includes("fuel"))
        return "Travel";

    if (text.includes("hotel") || text.includes("restaurant"))
        return "Food & Dining";

    if (text.includes("medicine") || text.includes("medical"))
        return "Health";

    return "General";
}

// ======= SAVE HISTORY =======
document.getElementById("saveBtn").onclick = function () {
    const date = document.getElementById("dateOut").innerText;
    const total = document.getElementById("totalOut").innerText;
    const merchant = document.getElementById("merchantOut").innerText;
    const category = document.getElementById("categoryOut").innerText;

    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    store.add({
        date,
        total,
        merchant,
        category,
        timestamp: Date.now()
    });

    tx.oncomplete = () => loadHistory();
};

// ======= LOAD HISTORY =======
function loadHistory() {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = function () {
        const list = document.getElementById("historyList");
        list.innerHTML = "";

        req.result.reverse().forEach(item => {
            const div = document.createElement("div");
            div.className = "history-item";
            div.innerHTML = `
                <strong>${item.merchant}</strong> - ₹${item.total}<br>
                <small>${item.date} • ${item.category}</small>
            `;
            list.appendChild(div);
        });
    };
}

// ======= PRINT INVOICE =======
document.getElementById("printInvoice").onclick = () => {
    window.print();
};

// ======= DIRECT PDF DOWNLOAD =======
document.getElementById("downloadInvoice").onclick = async () => {
    const content = document.querySelector(".result-box");

    const canvas = await html2canvas(content);
    const imgData = canvas.toDataURL("image/png");

    const pdf = new jspdf.jsPDF();
    pdf.addImage(imgData, "PNG", 10, 10, 180, 0);
    pdf.save("ANJ_Invoice.pdf");
};
                                                       
