import fs from "fs";
import path from "path";

const src = path.resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const dstDir = path.resolve("public/pdfjs");
const dst = path.resolve(dstDir, "pdf.worker.min.mjs");

fs.mkdirSync(dstDir, { recursive: true });
fs.copyFileSync(src, dst);

console.log("Copied PDF worker to", dst);
