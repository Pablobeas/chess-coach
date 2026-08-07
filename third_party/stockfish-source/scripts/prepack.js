#!/usr/bin/env node

/// License: MIT

/// Creates the bin dir for packaging.

"use strict";

var fs = require("fs");
var p = require("path");

var srcDir = p.join(__dirname, "..", "src");
var binDir = p.join(__dirname, "..", "bin");

var version = require("../package.json").buildVersion;

try {
    fs.mkdirSync(binDir)
} catch (e) {}

var engineMatch = new RegExp("^stockfish-" + version + "(-(asm|lite|single|lite-single))?(-[a-f0-9]{7})?(-part-\d+)?\.(js|wasm)$");

console.log(" *");
console.log(" * Building engines...");
console.log(" *");
require("child_process").execFileSync(p.join(__dirname, "..", "build.js"), ["--all", "--strict-em-check"], {stdio: "inherit"});
console.log(" *");
console.log(" * Finished building engines successfully.");
console.log(" *");

/// Remove anything there already.
fs.readdirSync(binDir).forEach(function (filename)
{
    fs.unlinkSync(p.join(binDir, filename));
});

fs.readdirSync(srcDir).forEach(function (filename)
{
    if (engineMatch.test(filename)) {
        fs.cpSync(p.join(srcDir, filename), p.join(binDir, filename));
    }
});
