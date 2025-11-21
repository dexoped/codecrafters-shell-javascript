const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// TODO: Uncomment the code below to pass the first stage
function promptUser() {
  rl.question("$ ", (answer) => {
    const cmd = answer;
    console.log(`${cmd}: command not found`);

  });
}
promptUser();

rl.on("SIGINT", () => {
  console.log("\nExiting");
  rl.close();
  process.exit(0);
});