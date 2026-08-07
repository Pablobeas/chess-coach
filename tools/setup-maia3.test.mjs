import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Maia manifest keeps the fixed upstream commit and checkpoint integrity data", () => {
  const manifest = JSON.parse(readFileSync("tools/maia3-manifest.json", "utf8"));

  assert.equal(manifest.python.min, "3.10");
  assert.equal(manifest.python.maxExclusive, "3.13");
  assert.equal(
    manifest.source.commit,
    "1e13597c42d4858b7cfd7cfdae01e297263364b2",
  );
  assert.equal(
    manifest.checkpoint.revision,
    "b6559de2398d7140b985f28fd2c19fb5e47ddabe",
  );
  assert.equal(
    manifest.checkpoint.sha256,
    "BA14208B2992D85502F5FB501934ABF6AAAEB355E9F3FDF90E326911F562524F",
  );
  assert.equal(manifest.checkpoint.sizeBytes, 20968049);
  assert.equal(manifest.reproducibility.portableTransitiveLock, false);
});

test("setup-maia3 warns before unresolved transitive installs and records a local resolution snapshot", () => {
  const script = readFileSync("tools/setup-maia3.ps1", "utf8");

  assert.match(script, /tools\\maia3-manifest\.json/);
  assert.match(script, /Write-Warning \("Advertencia: Maia-3 fija el commit de origen y el hash del checkpoint/);
  assert.match(script, /install-report\.json/);
  assert.match(script, /resolved-packages\.json/);
  assert.match(script, /--report/);
  assert.match(script, /git\+\$maiaRepository@\$\maiaCommit/);
  assert.match(script, /Get-FileHash -Algorithm SHA256/);
  assert.match(script, /\$checkpoint\.Length -ne \$checkpointSizeBytes/);
});
