function processFile() {
    const file = document.getElementById("fileInput").files[0];
    if (!file) return alert("Select a file first.");

    const type = file.type;

    if (type.includes("pdf")) extractPDF(file);
    else if (type.includes("image")) extractImage(file);
    else if (type.includes("text")) extractText(file);
    else alert("Unsupported file");
}

async function extractPDF(file) {
    const reader = new FileReader();
    reader.onload = async function () {
        const typedarray = new Uint8Array(this.result);

        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        let text = "";

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(i => i.str).join(" ") + "\n";
        }

        showParsed(text);
    };
    reader.readAsArrayBuffer(file);
}

async function extractImage(file) {
    const { data } = await Tesseract.recognize(file, "eng");
    showParsed(data.text);
}

function extractText(file) {
    const reader = new FileReader();
    reader.onload = () => showParsed(reader.result);
    reader.readAsText(file);
}

function showParsed(text) {
    document.getElementById("parsedData").classList.remove("hidden");
    document.getElementById("parsedOutput").textContent = text;
}

function generateFinalInvoice() {
    const output = document.getElementById("parsedOutput").textContent;

    // Basic parser (can upgrade later)
    const invoiceNo = output.match(/INV[-\s:]?\d+/i)?.[0] || "INV-2025-0012";
    const customer = output.match(/Name[:\s]+([A-Za-z ]+)/)?.[1] || "Client Name";
    const address = output.match(/Address[:\s]+(.+)/)?.[1] || "Client Address";

    const invoiceHTML = `
        <div class="invoiceBox">
            <span class="diamond"></span>
            <span class="inv-title">ANJ BUSINESS INVOICE</span>

            <p><b>Invoice No:</b> ${invoiceNo}</p>
            <p><b>Name:</b> ${customer}</p>
            <p><b>Address:</b> ${address}</p>

            <table class="table">
                <tr>
                    <th>#</th><th>Description</th><th>Qty</th><th>Rate</th><th>Total</th>
                </tr>
                <tr>
                    <td>1</td><td>Item From Bill</td><td>1</td><td>₹500</td><td>₹500</td>
                </tr>
            </table>
        </div>
    `;

    document.getElementById("invoiceArea").innerHTML = invoiceHTML;

    document.getElementById("finalInvoice").classList.remove("hidden");
    window.scrollTo(0, document.body.scrollHeight);
}
