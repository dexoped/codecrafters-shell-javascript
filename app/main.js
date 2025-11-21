const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// TODO: Uncomment the code below to pass the first stage
function promptUser() {
  rl.question("$ ", (answer) => {
    const cmd = answer.trim();
     if (cmd === "exit 0 ") process.exit(0);
    
    console.log(`${cmd}: command not found`);
    process.exit(0);
  });
}
promptUser();
