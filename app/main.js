const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const builtins = ["exit", "echo", "type"];
// TODO: Uncomment the code below to pass the first stage
function promptUser() {
  rl.question("$ ", (answer) => {
    const parts = answer.trim ().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
if (cmd === "exit") {
      rl.close();
      process.exit(0);
    }else if (cmd === "echo") {
        console.log(args.join(" "));
        promptUser();
    }else if (cmd === "type") {
        if (args.length === 0) {
            console.log("type: missing operand");
        } else {
            args.forEach((arg) => {
                if (builtins.includes(arg)) {
                    console.log(`${arg} is a shell builtin`);
                }
                else {
                    console.log(`${arg}: not found`);
                }
            })}
          }
    else{
        console.log(`${cmd}: command not found`);
        promptUser();
    }
  });
}
promptUser();