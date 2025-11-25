const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const builtins = ["exit", "echo", "type", "pwd", "cd"];

function findExecutable(cmdName) {
  const PATH = process.env.PATH || "";
  const pathDirs = PATH.split(":");
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = path.join(dir, cmdName);
    if (!fs.existsSync(candidate)) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (err) {
      continue;
    }
  }
  return null;
}

function splitArgs(line) {
  const tokens = [];
  let cur = "";
  let i = 0;
  const n = line.length;

  while (i < n) {
    const ch = line[i];

    if (ch === "'") {
      // Single-quote mode: copy literally until next '
      i++; // skip opening quote
      while (i < n && line[i] !== "'") {
        cur += line[i];
        i++;
      }
      // skip closing quote if present
      if (i < n && line[i] === "'") i++;
      // keep building current token
    } else if (ch === '"') {
      // Double-quote mode: copy literally until next "
      i++; // skip opening quote
      while (i < n && line[i] !== '"') {
        cur += line[i];
        i++;
      }
      // skip closing quote if present
      if (i < n && line[i] === '"') i++;
      // keep building current token
    } else if (/\s/.test(ch)) {
      // Whitespace outside quotes: token boundary (collapse multiple)
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
      while (i < n && /\s/.test(line[i])) i++;
    } else {
      cur += ch;
      i++;
    }
  }

  if (cur.length > 0) tokens.push(cur);
  return tokens;
}

function promptUser() {
  rl.question("$ ", (answer) => {
    const parts = splitArgs(answer);
    const cmd = parts[0];
    const args = parts.slice(1);

    if (!cmd) {
      return promptUser();
    }

    if (cmd === "exit") {
      rl.close();
      process.exit(0);
    } else if (cmd === "echo") {
      console.log(args.join(" "));
      promptUser();
    } else if (cmd === "pwd") {
      console.log(process.cwd());
      promptUser();
    } else if (cmd === "cd") {
      const target = args[0];
      if (!target) {
        promptUser();
        return;
      }

      let resolvedPath;
      if (target === "~") {
        const HOME = process.env.HOME;
        if (!HOME) {
          console.log(`cd: ${target}: No such file or directory`);
          promptUser();
          return;
        }
        resolvedPath = HOME;
      } else if (target.startsWith("~/")) {
        const HOME = process.env.HOME;
        if (!HOME) {
          console.log(`cd: ${target}: No such file or directory`);
          promptUser();
          return;
        }
        resolvedPath = path.join(HOME, target.slice(2));
      } else if (target.startsWith("/")) {
        resolvedPath = target;
      } else {
        resolvedPath = path.resolve(process.cwd(), target);
      }

      try {
        const stat = fs.statSync(resolvedPath);
        if (!stat.isDirectory()) {
          console.log(`cd: ${target}: No such file or directory`);
          promptUser();
          return;
        }
      } catch (err) {
        console.log(`cd: ${target}: No such file or directory`);
        promptUser();
        return;
      }

      try {
        process.chdir(resolvedPath);
      } catch (err) {
        console.log(`cd: ${target}: No such file or directory`);
      }
      promptUser();
    } else if (cmd === "type") {
      if (args.length === 0) {
        console.log("type: missing operand");
      } else {
        for (const arg of args) {
          if (builtins.includes(arg)) {
            console.log(`${arg} is a shell builtin`);
            continue;
          }

          const PATH = process.env.PATH || "";
          const pathDirs = PATH.split(":");
          let found = false;

          for (const dir of pathDirs) {
            if (!dir) continue;
            const candidate = path.join(dir, arg);

            if (!fs.existsSync(candidate)) continue;

            try {
              fs.accessSync(candidate, fs.constants.X_OK);
              console.log(`${arg} is ${candidate}`);
              found = true;
              break;
            } catch (err) {
              continue;
            }
          }

          if (!found) {
            console.log(`${arg}: not found`);
          }
        }
      }
      promptUser();
    } else {
      const exePath = findExecutable(cmd);
      if (exePath) {
        const child = spawn(exePath, args, { stdio: "inherit", argv0: cmd });

        child.on("exit", (code, signal) => {
          promptUser();
        });

        child.on("error", (err) => {
          console.log(`${cmd}: ${err.message}`);
          promptUser();
        });
      } else {
        console.log(`${cmd}: command not found`);
        promptUser();
      }
    }
  });
}

promptUser();
