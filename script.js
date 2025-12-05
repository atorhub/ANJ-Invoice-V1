// Example parsed items from your parser
const parsedItems = [
    { description: "Wireless Keyboard", qty: 2, price: 1299 },
    { description: "USB-C Cable", qty: 3, price: 299 },
    { description: "Monitor Stand", qty: 1, price: 1599 },
];

function loadInvoice() {
    let tbody = document.getElementById("invoice-items");
    let subtotal = 0;

    parsedItems.forEach((item, i) => {
        let row = `
            <tr>
                <td>${i + 1}</td>
                <td>${item.description}</td>
                <td>${item.qty}</td>
                <td>₹${item.price}</td>
                <td>₹${item.qty * item.price}</td>
            </tr>
        `;
        subtotal += item.qty * item.price;
        tbody.innerHTML += row;
    });

    let taxVal = subtotal * 0.05;
    let grand = subtotal + taxVal;

    document.getElementById("subtotal").textContent = "₹" + subtotal.toFixed(2);
    document.getElementById("tax").textContent = "₹" + taxVal.toFixed(2);
    document.getElementById("grandTotal").textContent = "₹" + grand.toFixed(2);
}

loadInvoice();
