console.log("Hello from Node.js!");
let count = 0;
const interval = setInterval(() => {
    count++;
    console.log(`Streaming output ${count}/3...`);
    if (count >= 3) {
        clearInterval(interval);
        console.log("Node.js execution complete.");
    }
}, 500);
