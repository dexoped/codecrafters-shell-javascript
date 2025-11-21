const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
// TODO: Uncomment the code below to pass the first stage
function promptUser() {
  rl.question("$ ", (answer) => {
    const cmd = answer;
if (cmd === "exit") {
      rl.close();
      process.exit(0);
    }
    else{
        console.log(`${cmd}: command not found`);
        promptUser();
    }
  });
}
promptUser();