import { strict as assert } from 'node:assert';
// We copy the function directly here for testing to avoid module import issues,
// since memory states: "In environments where dependency installation is restricted, implement tests as standalone Node.js scripts that use zero external dependencies, utilize Node.js built-ins, and exit with code 1 on failure to remain CI-compatible."
// Actually we can read the function using fs and evaluate it, or just copy it.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceCode = fs.readFileSync(path.join(__dirname, 'firebase.ts'), 'utf8');

// Quick and dirty extraction of the function
const funcMatch = sourceCode.match(/export const bookKeyToDocId = \([\s\S]*?=>\s*{([\s\S]*?)};\n/);
if (!funcMatch) {
  console.error("Could not extract bookKeyToDocId function");
  process.exit(1);
}

const bookKeyToDocId = new Function('key', funcMatch[1]);

function runTests() {
  const tests = [
    { input: "ot:Song of Solomon", expected: "ot_3ASong_20of_20Solomon" },
    { input: "nt:1 John_1-2~!", expected: "nt_3A1_20John_5F1_2D2_7E_21" },
    { input: "1-2-3", expected: "1_2D2_2D3" },
    { input: "1_2_3", expected: "1_5F2_5F3" },
    { input: "A...B", expected: "A_2E_2E_2EB" },
    { input: "hello/world", expected: "hello_2Fworld" },
    { input: "emoji🚀", expected: "emoji_F0_9F_9A_80" }
  ];

  tests.forEach(({ input, expected }, idx) => {
    const result = bookKeyToDocId(input);
    try {
      assert.equal(result, expected);
      console.log(`Test ${idx + 1} passed`);
    } catch (err) {
      console.error(`Test ${idx + 1} failed: expected ${expected}, got ${result}`);
      process.exit(1);
    }
  });

  // Verify uniqueness (collision prevention)
  const id1 = bookKeyToDocId("1-2-3");
  const id2 = bookKeyToDocId("1_2_3");
  assert.notEqual(id1, id2, "Collisions detected!");
  console.log("Uniqueness test passed.");

  console.log("All tests passed!");
}

runTests();
