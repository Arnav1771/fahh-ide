// Build the `fahh-agent` terminal binary and put it where Tauri's externalBin
// expects it: src-tauri/binaries/fahh-agent-<target-triple>[.exe]. Run by
// `beforeBuildCommand`, so installers ship it next to the editor and
// `fahh agent ...` finds it. (src-tauri/build.rs makes a stand-in for plain
// `cargo build` / `cargo test`, which never bundle.)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (.+)$/m)[1];
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const ext = triple.includes("windows") ? ".exe" : "";

const args = ["build", "--release", "--bin", "fahh-agent", "--manifest-path", path.join(root, "src-tauri", "Cargo.toml")];
if (triple !== host) args.push("--target", triple);
execFileSync("cargo", args, { stdio: "inherit", cwd: root });

const targetDir = process.env.CARGO_TARGET_DIR || path.join(root, "target");
const built = path.join(targetDir, triple !== host ? triple : "", "release", `fahh-agent${ext}`);
const dest = path.join(root, "src-tauri", "binaries", `fahh-agent-${triple}${ext}`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(built, dest);
console.log(`fahh-agent -> ${path.relative(root, dest)}`);
