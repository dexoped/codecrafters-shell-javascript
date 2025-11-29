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
      i++;
      while (i < n && line[i] !== "'") {
        cur += line[i];
        i++;
      }
      if (i < n && line[i] === "'") i++;
    } else if (ch === '"') {
      i++;
      while (i < n && line[i] !== '"') {
        if (line[i] === "\\") {
          if (i + 1 < n) {
            const next = line[i + 1];
            if (next === '"' || next === "\\") {
              cur += next;
              i += 2;
            } else {
              cur += "\\";
              i++;
            }
          } else {
            cur += "\\";
            i++;
          }
        } else {
          cur += line[i];
          i++;
        }
      }
      if (i < n && line[i] === '"') i++;
    } else if (ch === "\\") {
      if (i + 1 < n) {
        cur += line[i + 1];
        i += 2;
      } else {
        i++;
      }
    } else if (/\s/.test(ch)) {
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

/**
 * Scan tokens for output redirection > or N> where N is a fd number.
 * Returns an object { args, outFile, outFdNum } where:
 * - args: tokens with redirection removed
 * - outFile: path string or null
 * - outFdNum: the numeric fd targeted (1 for stdout) or null
 *
 * For this stage we only act on fd 1 (or unspecified => default to 1).
 */
function extractRedirection(tokens) {
  const args = [];
  let outFile = null;
  let outFdNum = null;

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    // Case: token exactly ">" or "N>"
    const m1 = t.match(/^(\d*)>$/);
    if (m1) {
      const fdPart = m1[1]; // "" or "1"
      const fdNum = fdPart === "" ? 1 : parseInt(fdPart, 10);
      const next = tokens[i + 1];
      if (next) {
        // consume both tokens
        if (fdNum === 1) {
          outFile = next;
          outFdNum = 1;
        }
        i += 2;
        continue;
      } else {
        // no filename provided; ignore this redirection token
        i++;
        continue;
      }
    }

    // Case: token like ">filename" or "1>filename"
    const m2 = t.match(/^(\d*)>(.+)$/);
    if (m2) {
      const fdPart = m2[1];
      const fdNum = fdPart === "" ? 1 : parseInt(fdPart, 10);
      const filename = m2[2];
      if (fdNum === 1) {
        outFile = filename;
        outFdNum = 1;
      }
      i++;
      continue;
    }

    // Not a redirection token -> keep it
    args.push(t);
    i++;
  }

  return { args, outFile, outFdNum };
}

function promptUser() {
  rl.question("$ ", (answer) => {
    const parts = splitArgs(answer);
    const { args: cleanedParts, outFile, outFdNum } = extractRedirection(parts);
    const partsFinal = cleanedParts;
    const cmd = partsFinal[0];
    const args = partsFinal.slice(1);

    if (!cmd) {
      return promptUser();
    }

    // Helper to write a builtin's output to a file (synchronously) if needed.
    function writeToFileAndClose(filename, data) {
      try {
        const fd = fs.openSync(filename, "w");
        fs.writeSync(fd, data);
        fs.closeSync(fd);
      } catch (err) {
        // If we can't write to the file, mimic shell behavior by printing an error.
        console.log(`redirect: ${err.message}`);
      }
    }

    if (cmd === "exit") {
      rl.close();
      process.exit(0);
    } else if (cmd === "echo") {
      const out = args.join(" ") + "\n";
      if (outFile && outFdNum === 1) {
        writeToFileAndClose(outFile, out);
        promptUser();
      } else {
        process.stdout.write(out);
        promptUser();
      }
    } else if (cmd === "pwd") {
      const out = process.cwd() + "\n";
      if (outFile && outFdNum === 1) {
        writeToFileAndClose(outFile, out);
        promptUser();
      } else {
        console.log(process.cwd());
        promptUser();
      }
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
      // external command
      const exePath = findExecutable(cmd);
      if (exePath) {
        if (outFile && outFdNum === 1) {
          // redirect stdout to file (overwrite)
          let outFd;
          try {
            outFd = fs.openSync(outFile, "w");
          } catch (err) {
            console.log(`${cmd}: ${err.message}`);
            promptUser();
            return;
          }

          const child = spawn(exePath, args, {
            stdio: ["inherit", outFd, "inherit"],
            argv0: cmd,
          });

          child.on("exit", (code, signal) => {
            try {
              fs.closeSync(outFd);
            } catch (err) {
              // ignore
            }
            promptUser();
          });

          child.on("error", (err) => {
            try {
              fs.closeSync(outFd);
            } catch (e) {
              // ignore
            }
            console.log(`${cmd}: ${err.message}`);
            promptUser();
          });
        } else {
          // no redirection -> normal spawn with inherited stdio
          const child = spawn(exePath, args, { stdio: "inherit", argv0: cmd });

          child.on("exit", (code, signal) => {
            promptUser();
          });

          child.on("error", (err) => {
            console.log(`${cmd}: ${err.message}`);
            promptUser();
          });
        }
      } else {
        console.log(`${cmd}: command not found`);
        promptUser();
      }
    }
  });
}

promptUser();
