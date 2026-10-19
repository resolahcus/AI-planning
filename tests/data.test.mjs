import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateData, validateDataset, validateSourceFiles, DataValidationError } from '../scripts/validate-data.mjs';

const questionDocument = JSON.parse(await readFile(new URL('../data/questions.json', import.meta.url), 'utf8'));
const sourceDocument = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));

test('all 300 questions, 1200 options and six original PDF hashes validate', async () => {
  const summary = await validateData();
  assert.equal(summary.questionCount, 300);
  assert.equal(summary.optionCount, 1200);
  assert.equal(summary.sourceCount, 6);
  assert.equal(summary.pdfCount, 6);
  assert.equal(summary.pageCount, 80);
  assert.ok(summary.totalBytes > 0);
});

test('validator rejects missing questions, duplicate IDs and duplicate question numbers', () => {
  const missing = structuredClone(questionDocument);
  missing.questions.pop();
  assert.throws(() => validateDataset(missing, sourceDocument), /Exactly 300/);
  const duplicate = structuredClone(questionDocument);
  duplicate.questions[1] = structuredClone(duplicate.questions[0]);
  assert.throws(() => validateDataset(duplicate, sourceDocument), /duplicate ID/);
});

test('validator rejects invalid answers, duplicate options and unprovided explanations', () => {
  for (const mutate of [
    (question) => { question.answer = 'E'; },
    (question) => { question.options[1].key = 'A'; },
    (question) => { question.options[1].text = question.options[0].text; },
    (question) => { question.options[2].text = ''; },
    (question) => { question.explanation = 'Unverified generated explanation'; },
  ]) {
    const changed = structuredClone(questionDocument);
    mutate(changed.questions[0]);
    assert.throws(() => validateDataset(changed, sourceDocument), DataValidationError);
  }
});

test('validator rejects incorrect source references and PDF page ranges', () => {
  for (const mutate of [
    (question) => { question.sourceId = 'unknown'; },
    (question) => { question.subject = 2; },
    (question) => { question.sourcePages = [0]; },
    (question) => { question.sourcePages = [999]; },
    (question) => { question.sourcePages = [2, 1]; },
    (question) => { question.sourcePages = [1, 1]; },
  ]) {
    const changed = structuredClone(questionDocument);
    mutate(changed.questions[0]);
    assert.throws(() => validateDataset(changed, sourceDocument), DataValidationError);
  }
});

test('PDF validation detects changed hashes and unsafe file paths without mutating files', async () => {
  const changed = structuredClone(sourceDocument.sources);
  changed[0].sha256 = '0'.repeat(64);
  await assert.rejects(validateSourceFiles(changed), /SHA-256 does not match/);
  changed[0].file = '../private.pdf';
  await assert.rejects(validateSourceFiles(changed), /invalid PDF path/);
});

test('malformed top-level documents fail with a clear validation error', () => {
  assert.throws(() => validateDataset(null, sourceDocument), DataValidationError);
  assert.throws(() => validateDataset(questionDocument, { sources: null }), DataValidationError);
});
