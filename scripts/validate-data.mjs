import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANSWERS = ['A', 'B', 'C', 'D'];
const EXPECTED_SOURCE_IDS = ['115-1-1', '115-1-2', '115-2-1', '115-2-2', '115-3-1', '115-3-2'];

export class DataValidationError extends Error {
  constructor(errors) {
    super(`Question bank validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    this.name = 'DataValidationError';
    this.errors = errors;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0 && !/[\u0000\uFFFD]/u.test(value);

/** Validate source references and all question fields without changing original text. */
export function validateDataset(questionDocument, sourceDocument) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  if (!isObject(questionDocument) || !Array.isArray(questionDocument.questions)) errors.push('questions.json must contain a questions array.');
  if (!isObject(sourceDocument) || !Array.isArray(sourceDocument.sources)) errors.push('sources.json must contain a sources array.');
  if (errors.length) throw new DataValidationError(errors);

  const { questions } = questionDocument;
  const { sources } = sourceDocument;
  check(questionDocument.version === '115-2026-v1', 'Unexpected question bank version.');
  check(sources.length === 6, 'Exactly six source documents are required.');
  check(questions.length === 300, 'Exactly 300 questions are required.');
  const sourceMap = new Map();
  const sourceFiles = new Set();
  for (const [index, source] of sources.entries()) {
    if (!isObject(source)) { errors.push(`Source ${index} must be an object.`); continue; }
    const label = `Source ${source.id ?? index}`;
    check(EXPECTED_SOURCE_IDS.includes(source.id), `${label}: unknown ID.`);
    check(!sourceMap.has(source.id), `${label}: duplicate ID.`);
    check(source.year === 115 && [1, 2, 3].includes(source.round) && [1, 2].includes(source.subject), `${label}: invalid year, round or subject.`);
    check(source.id === `${source.year}-${source.round}-${source.subject}`, `${label}: ID does not match source metadata.`);
    check(source.file === `sources/115-r${source.round}-s${source.subject}.pdf`, `${label}: unexpected PDF path.`);
    check(!sourceFiles.has(source.file), `${label}: duplicate PDF path.`);
    check(typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(source.sha256), `${label}: invalid SHA-256.`);
    check(Number.isInteger(source.pages) && source.pages > 0, `${label}: invalid page count.`);
    check(source.questionCount === 50, `${label}: expected 50 questions.`);
    for (const field of ['title', 'originalFilename', 'answerSource']) check(isText(source[field]), `${label}: missing ${field}.`);
    sourceMap.set(source.id, source);
    sourceFiles.add(source.file);
  }
  for (const id of EXPECTED_SOURCE_IDS) check(sourceMap.has(id), `Missing source ${id}.`);

  const questionIds = new Set();
  const numbersBySource = new Map(EXPECTED_SOURCE_IDS.map((id) => [id, []]));
  let optionCount = 0;
  for (const [index, question] of questions.entries()) {
    if (!isObject(question)) { errors.push(`Question ${index} must be an object.`); continue; }
    const label = `Question ${question.id ?? index}`;
    check(isText(question.id) && !questionIds.has(question.id), `${label}: invalid or duplicate ID.`);
    questionIds.add(question.id);
    const source = sourceMap.get(question.sourceId);
    check(Boolean(source), `${label}: unknown sourceId.`);
    check(Number.isInteger(question.number) && question.number >= 1 && question.number <= 50, `${label}: invalid question number.`);
    check(question.id === `${question.sourceId}-${String(question.number).padStart(3, '0')}`, `${label}: ID does not match its source and number.`);
    if (source) {
      check(question.subject === source.subject && question.round === source.round, `${label}: round or subject differs from its source.`);
      numbersBySource.get(source.id)?.push(question.number);
    }
    check(isText(question.stem), `${label}: empty or invalid stem.`);
    check(ANSWERS.includes(question.answer), `${label}: answer must be A, B, C or D.`);
    check(question.explanation === null, `${label}: original PDFs do not provide explanations; expected null.`);

    const options = Array.isArray(question.options) ? question.options : [];
    optionCount += options.length;
    check(options.length === 4, `${label}: exactly four options are required.`);
    check(options.every((option, optionIndex) => isObject(option) && option.key === ANSWERS[optionIndex] && isText(option.text)), `${label}: options must have unique A-D keys in order and nonempty text.`);
    check(new Set(options.filter(isObject).map((option) => option.text)).size === 4, `${label}: option text must not be duplicated.`);
    check(options.some((option) => isObject(option) && option.key === question.answer), `${label}: answer does not identify an available option.`);

    const pages = Array.isArray(question.sourcePages) ? question.sourcePages : [];
    check(pages.length > 0 && pages.every((page, pageIndex) => Number.isInteger(page) && page >= 1 && (!source || page <= source.pages) && (pageIndex === 0 || page > pages[pageIndex - 1])), `${label}: sourcePages must be unique, ascending, valid PDF page numbers.`);
  }
  for (const [id, numbers] of numbersBySource) {
    const sorted = [...numbers].sort((a, b) => a - b);
    check(sorted.length === 50 && sorted.every((number, index) => number === index + 1), `Source ${id}: question numbers must be exactly 1-50, without duplicates.`);
  }
  if (errors.length) throw new DataValidationError(errors);
  return { version: questionDocument.version, sourceCount: sources.length, questionCount: questions.length, optionCount, pageCount: sources.reduce((sum, source) => sum + source.pages, 0) };
}

/** Recompute all six hashes against the exact PDFs shipped with the application. */
export async function validateSourceFiles(sources, root = APP_ROOT) {
  const actualRoot = await realpath(resolve(root));
  const errors = [];
  let totalBytes = 0;
  for (const source of sources) {
    if (typeof source.file !== 'string' || !/^sources\/115-r[123]-s[12]\.pdf$/u.test(source.file)) {
      errors.push(`Source ${source.id}: invalid PDF path.`);
      continue;
    }
    try {
      const path = await realpath(resolve(actualRoot, source.file));
      const rel = relative(actualRoot, path);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
        errors.push(`Source ${source.id}: PDF resolves outside the application directory.`);
        continue;
      }
      const bytes = await readFile(path);
      totalBytes += bytes.length;
      if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) errors.push(`Source ${source.id}: file is not a PDF.`);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== source.sha256) errors.push(`Source ${source.id}: PDF SHA-256 does not match its source manifest.`);
    } catch {
      errors.push(`Source ${source.id}: PDF could not be read.`);
    }
  }
  const actualFiles = (await readdir(resolve(actualRoot, 'sources'))).filter((name) => name.toLowerCase().endsWith('.pdf')).sort();
  const expectedFiles = sources.map((source) => source.file?.split('/').at(-1)).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) errors.push('The sources directory must contain exactly the six declared PDF files.');
  if (errors.length) throw new DataValidationError(errors);
  return { pdfCount: sources.length, totalBytes };
}

export async function validateData({ root = APP_ROOT } = {}) {
  const [questionDocument, sourceDocument] = await Promise.all([
    readFile(resolve(root, 'data/questions.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'data/sources.json'), 'utf8').then(JSON.parse),
  ]);
  const summary = validateDataset(questionDocument, sourceDocument);
  return { ...summary, ...await validateSourceFiles(sourceDocument.sources, root) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify({ valid: true, ...await validateData() }, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
