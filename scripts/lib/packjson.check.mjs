import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jsonArrayFrom } from './packjson.mjs';

const json = '[\n  {\n    "name": "x",\n    "files": [{ "path": "a" }]\n  }\n]\n';

test('plain npm pack output', () => {
  assert.equal(jsonArrayFrom(json)[0].name, 'x');
});

test('lifecycle output before the JSON is ignored', () => {
  const noisy = 'patch-package 8.0.1\nApplying patches...\nNo patch files found\n' + json;
  assert.equal(jsonArrayFrom(noisy)[0].files[0].path, 'a');
});

test('output that is not JSON still throws', () => {
  assert.throws(() => jsonArrayFrom('patch-package only'));
});
