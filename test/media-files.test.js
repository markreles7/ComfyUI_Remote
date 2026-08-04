import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  inspectImageFiles,
  readImageDimensions,
  resolveMediaFile,
  streamMediaFile,
} from "../src/media-files.js";

function fixture(subfolder = "video") {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ltx-media-"));
  const directory = path.join(temp, "output", subfolder);
  fs.mkdirSync(directory, { recursive: true });
  const video = path.join(directory, "result.mp4");
  fs.writeFileSync(video, "video");
  return { temp, video };
}

test("risolve un video partendo dalla cartella output", () => {
  const { temp, video } = fixture();
  const match = resolveMediaFile(path.join(temp, "output"), {
    filename: "result.mp4",
    subfolder: "video",
  });
  assert.equal(match.path, video);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("supporta la vecchia configurazione che termina con output/video", () => {
  const { temp, video } = fixture();
  const match = resolveMediaFile(path.join(temp, "output", "video"), {
    filename: "result.mp4",
    subfolder: "video",
  });
  assert.equal(match.path, video);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("risolve altre sottocartelle dalla vecchia configurazione", () => {
  const { temp, video } = fixture("2026-07-25");
  const match = resolveMediaFile(path.join(temp, "output", "video"), {
    filename: "result.mp4",
    subfolder: "2026-07-25",
  });
  assert.equal(match.path, video);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("serve richieste Range con stato 206", async () => {
  const { temp, video } = fixture();
  fs.writeFileSync(video, "0123456789");
  const match = resolveMediaFile(path.join(temp, "output"), {
    filename: "result.mp4",
    subfolder: "video",
  });

  const server = http.createServer((request, response) => {
    response.status = (code) => {
      response.statusCode = code;
      return response;
    };
    streamMediaFile(request, response, match, "result.mp4");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const result = await new Promise((resolve, reject) => {
    http.get({
      hostname: "127.0.0.1",
      port: address.port,
      headers: { range: "bytes=2-5" },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        range: response.headers["content-range"],
        body: Buffer.concat(chunks).toString(),
      }));
    }).on("error", reject);
  });
  server.close();

  assert.deepEqual(result, {
    status: 206,
    range: "bytes 2-5/10",
    body: "2345",
  });
  fs.rmSync(temp, { recursive: true, force: true });
});

test("legge le dimensioni PNG reali senza decodificare l'immagine", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ltx-image-size-"));
  const file = path.join(temp, "result.png");
  const header = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
  header.writeUInt32BE(2048, 16);
  header.writeUInt32BE(2633, 20);
  fs.writeFileSync(file, header);
  assert.deepEqual(readImageDimensions(file), { width: 2048, height: 2633 });
  fs.rmSync(temp, { recursive: true, force: true });
});

test("ispeziona i file immagine e rende rilevabili output corrotti larghi 3 px", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ltx-image-inspect-"));
  const output = path.join(temp, "output");
  fs.mkdirSync(output, { recursive: true });
  const header = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
  header.writeUInt32BE(3, 16);
  header.writeUInt32BE(2048, 20);
  fs.writeFileSync(path.join(output, "broken.png"), header);
  const [result] = inspectImageFiles(output, [{ filename: "broken.png", type: "output" }]);
  assert.equal(result.width, 3);
  assert.equal(result.height, 2048);
  fs.rmSync(temp, { recursive: true, force: true });
});
