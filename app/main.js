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
 * Scan tokens for redirections like:
 *   > file        (means 1> file)
 *   1> file
 *   2> file
 *   >file, 1>file, 2>file
 *
 * Returns { args, redirs } where:
 *  - args: tokens with redirection tokens removed
 *  - redirs: object mapping fd number -> filename (e.g. { "1": "/tmp/out", "2": "/tmp/err" })
 *
 * Only fd 0..2 are meaningful for spawn's stdio. We store any numeric fd encountered,
 * but during spawn we only use 1 (stdout) and 2 (stderr).
 */
function extractRedirection(tokens) {
  const args = [];
  const redirs = {}; // fdNum (number) -> filename

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    // Case: token exactly ">" or "N>"
    const m1 = t.match(/^(\d*)>$/);
    if (m1) {
      const fdPart = m1[1]; // "" or "1" or "2"
      const fdNum = fdPart === "" ? 1 : parseInt(fdPart, 10);
      const next = tokens[i + 1];
      if (next) {
        redirs[fdNum] = next;
        i += 2;
        continue;
      } else {
        // no filename provided; ignore this token
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
      redirs[fdNum] = filename;
      i++;
      continue;
    }

    // Not a redirection token -> keep it
    args.push(t);
    i++;
  }

  return { args, redirs };
}

function promptUser() {
  rl.question("$ ", (answer) => {
    const parts = splitArgs(answer);
    const { args: cleanedParts, redirs } = extractRedirection(parts);
    const partsFinal = cleanedParts;
    const cmd = partsFinal[0];
    const args = partsFinal.slice(1);

    if (!cmd) {
      return promptUser();
    }

    function writeToFileAndClose(filename, data) {
      try {
        const fd = fs.openSync(filename, "w");
        fs.writeSync(fd, data);
        fs.closeSync(fd);
      } catch (err) {
        console.log(`redirect: ${err.message}`);
      }
    }

    if (cmd === "exit") {
      rl.close();
      process.exit(0);
    } else if (cmd === "echo") {
      const out = args.join(" ") + "\n";
      if (redirs[1]) {
        writeToFileAndClose(redirs[1], out);
        promptUser();
      } else {
        process.stdout.write(out);
        promptUser();
      }
    } else if (cmd === "pwd") {
      const out = process.cwd() + "\n";
      if (redirs[1]) {
        writeToFileAndClose(redirs[1], out);
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
        // Prepare file descriptors for redirection (if any)
        let outFd = null;
        let errFd = null;
        try {
          if (redirs[1]) {
            outFd = fs.openSync(redirs[1], "w");
          }
          if (redirs[2]) {
            errFd = fs.openSync(redirs[2], "w");
          }
        } catch (err) {
          // Could not open file for writing
          console.log(`${cmd}: ${err.message}`);
          // Close any opened fds before returning
          try {
            if (outFd !== null) fs.closeSync(outFd);
          } catch (e) {}
          try {
            if (errFd !== null) fs.closeSync(errFd);
          } catch (e) {}
          promptUser();
          return;
        }

        // Build stdio array: [ stdin, stdout, stderr ]
        const stdio = [
          "inherit",
          outFd !== null ? outFd : "inherit",
          errFd !== null ? errFd : "inherit",
        ];

        const child = spawn(exePath, args, { stdio, argv0: cmd });

        child.on("exit", (code, signal) => {
          // close fds if opened
          try {
            if (outFd !== null) fs.closeSync(outFd);
          } catch (e) {}
          try {
            if (errFd !== null) fs.closeSync(errFd);
          } catch (e) {}
          promptUser();
        });

        child.on("error", (err) => {
          try {
            if (outFd !== null) fs.closeSync(outFd);
          } catch (e) {}
          try {
            if (errFd !== null) fs.closeSync(errFd);
          } catch (e) {}
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
