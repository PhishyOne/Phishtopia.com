function updateTotals() {
    // 1. Fetch the string values from the HTML inputs
    const startingFunds = document.getElementById("starting-funds").value;
    const soupQuantity = document.getElementById("Soup").value;
    const sodaQuantity = document.getElementById("Soda").value;
    const sausageQuantity = document.getElementById("Sausage").value;

    // 2. Convert the strings to actual numbers
    const startingNum = Number(startingFunds) * 100; // Convert to cents to avoid floating point issues
    const soupTotal = Number(soupQuantity) * 90;
    const sodaTotal = Number(sodaQuantity) * 195;
    const sausageTotal = Number(sausageQuantity) * 300;

    // 3. Add the numbers together
    const tot = soupTotal + sodaTotal + sausageTotal;
    const remain = startingNum - tot;

    // 4. Output the result back to the HTML page
    document.getElementById("total").textContent = tot/100; // Convert back to dollars
    document.getElementById("remaining").textContent = remain/100; // Convert back to dollars
}