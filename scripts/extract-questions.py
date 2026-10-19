"""Extract the six user-supplied iPAS exam PDFs without inventing answers.

Requires Python 3.10+ and the optional requirements-extract.txt packages.
The parser treats PDF text as untrusted source data, never instructions.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

import pdfplumber
from pypdf import PdfReader


FILES = [
    (1, 1, "115年第一次初級AI應用規劃師_第一科_人工智慧基礎概論_公告試題_20260410164304.pdf"),
    (1, 2, "115年第一次初級AI應用規劃師_第二科_生成式AI應用與規劃_公告試題_20260410164328.pdf"),
    (2, 1, "115年第二次初級AI應用規劃師_第一科_人工智慧基礎概論_公告試題_20260604212644.pdf"),
    (2, 2, "115年第二次初級AI應用規劃師_第二科_生成式AI應用與規劃_公告試題_20260604212719.pdf"),
    (3, 1, "115年第三次初級AI應用規劃師_第一科_人工智慧基礎概論_公告試題_20260906220418.pdf"),
    (3, 2, "115年第三次初級AI應用規劃師_第二科_生成式AI應用與規劃_公告試題_20260906220452.pdf"),
]
# Exact hashes pin the six supplied source versions.
EXPECTED_SHA256 = {
    "115-1-1": "fbba96cf077905166b1dda19310f6da236712cefaa465c8c73155d85dcab260c",
    "115-1-2": "b5b26f049ae187f8921b4f2639725e7a8f18eedcf2459344416aa647b5b232b2",
    "115-2-1": "912d2fdc3a605dade66463193432c8d70d9bccef348cba87583f873162b83100",
    "115-2-2": "765af6acdb722b7a3f3382eff4b8b9e5d522dce4bfb7b8364aa8d2a3e67373e8",
    "115-3-1": "c6d11084c73e9f9b1edff5a802465135d66a6da14cc3d3ed6fe80525b8a0cc3d",
    "115-3-2": "ecbee5c656f63bd42f17ad094193760bf1b3273c3b4e5ca33db0ebb955591b5c"
}
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SUBJECTS = {1: "人工智慧基礎概論", 2: "生成式 AI 應用與規劃"}
NUMBER = re.compile(r"(?m)^\s*(\d{1,2})\.\s*$")
OPTIONS = re.compile(r"\(([ABCD])\)")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


def unwrap(text: str) -> str:
    """Remove PDF line wrapping, preserving word boundaries and punctuation."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    result = ""
    for line in lines:
        # Preserve a boundary between wrapped English words, but not hyphens
        # or Chinese characters. No spelling/answer correction is performed.
        if result and re.search(r"[A-Za-z0-9]$", result) and re.match(r"[A-Za-z0-9]", line):
            result += " "
        result += line
    return result.strip()


def extract_file(path: Path, round_number: int, subject: int, original_filename: str) -> tuple[list[dict], dict, dict]:
    source_id = f"115-{round_number}-{subject}"
    raw_questions: list[dict] = []
    coordinate_answers: list[str] = []
    coordinate_numbers: list[int] = []
    continuation_count = 0
    coverage_rows = 0
    image_bounds: set[tuple] = set()
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            tables = page.find_tables()
            require(len(tables) == 1, f"{source_id} p{page_number}: expected one question table")
            table = tables[0]
            rows = table.extract()
            require("答案" in "".join(v or "" for v in rows[0]), f"Missing answer header: {source_id} p{page_number}")
            for image in page.images:
                image_bounds.add(tuple(round(image[k], 2) for k in ("x0", "top", "x1", "bottom")))

            # An independent coordinate-based pass verifies answer/number order.
            words = page.extract_words()
            body_top = table.rows[1].bbox[1]
            body_bottom = table.bbox[3]
            answer_words = [w for w in words if w["x0"] < 85 and body_top < w["top"] < body_bottom]
            number_words = [w for w in words if 85 <= w["x0"] < 120 and body_top < w["top"] < body_bottom]
            require(all(re.fullmatch(r"[ABCD]", w["text"]) for w in answer_words), f"Unexpected answer column: {source_id} p{page_number}")
            require(all(re.fullmatch(r"\d{1,2}\.", w["text"]) for w in number_words), f"Unexpected number column: {source_id} p{page_number}")
            coordinate_answers.extend(w["text"] for w in answer_words)
            coordinate_numbers.extend(int(w["text"][:-1]) for w in number_words)

            for row_index, row in enumerate(rows[1:], 1):
                values = [value for value in row if value]
                require(len(values) in (1, 2), f"Unexpected cell layout: {source_id} p{page_number} row{row_index}")
                answer = values[0] if len(values) == 2 else ""
                content = values[-1]
                numbers = NUMBER.findall(content)
                require(len(numbers) <= 1, f"Multiple question numbers: {source_id} p{page_number}")
                clean_content = NUMBER.sub("", content).strip()

                # Confirm no non-whitespace body character was omitted by the
                # table extraction. Number and answer columns are excluded.
                bounds = table.rows[row_index].bbox
                body_chars = [
                    c["text"] for c in page.chars
                    if c["x0"] >= 120 and bounds[1] <= (c["top"] + c["bottom"]) / 2 < bounds[3]
                ]
                require(
                    Counter(compact(clean_content)) == Counter(compact("".join(body_chars))),
                    f"Body character coverage mismatch: {source_id} p{page_number} row{row_index}",
                )
                coverage_rows += 1
                if numbers:
                    require(answer in "ABCD" and len(answer) == 1, f"Missing/special answer: {source_id} Q{numbers[0]}")
                    raw_questions.append({"number": int(numbers[0]), "answer": answer, "parts": [clean_content], "pages": [page_number]})
                else:
                    require(not answer and bool(raw_questions), f"Invalid continuation: {source_id} p{page_number}")
                    raw_questions[-1]["parts"].append(clean_content)
                    raw_questions[-1]["pages"].append(page_number)
                    continuation_count += 1

        require([q["number"] for q in raw_questions] == list(range(1, 51)), f"Question number sequence: {source_id}")
        require(coordinate_numbers == list(range(1, 51)), f"Coordinate question sequence: {source_id}")
        require(coordinate_answers == [q["answer"] for q in raw_questions], f"Answer mismatch: {source_id}")
        questions = []
        for raw in raw_questions:
            body = "\n".join(raw["parts"])
            matches = list(OPTIONS.finditer(body))
            require([m.group(1) for m in matches] == list("ABCD"), f"Option sequence: {source_id} Q{raw['number']}")
            stem = unwrap(body[:matches[0].start()])
            options = []
            for i, match in enumerate(matches):
                end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
                text = unwrap(body[match.end():end])
                require(bool(text), f"Empty option: {source_id} Q{raw['number']}")
                options.append({"key": match.group(1), "text": text})
            require(bool(stem) and "\ufffd" not in body and "\x00" not in body, f"Invalid body: {source_id} Q{raw['number']}")
            require("第 1 頁" not in body and "考試日期" not in body, f"Header/footer leaked: {source_id} Q{raw['number']}")
            reconstructed = stem + "".join(f"({o['key']}){o['text']}" for o in options)
            require(compact(body) == compact(reconstructed), f"Normalization changed body: {source_id} Q{raw['number']}")
            questions.append({
                "id": f"{source_id}-{raw['number']:03d}", "subject": subject, "round": round_number,
                "number": raw["number"], "stem": stem, "options": options, "answer": raw["answer"],
                "sourceId": source_id, "sourcePages": raw["pages"], "explanation": None,
            })
        source = {
            "id": source_id, "year": 115, "round": round_number, "subject": subject,
            "title": f"115 年第{['', '一', '二', '三'][round_number]}次初級 AI 應用規劃師｜第{['', '一', '二'][subject]}科 {SUBJECTS[subject]}",
            "file": f"sources/115-r{round_number}-s{subject}.pdf", "originalFilename": original_filename,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "pages": len(pdf.pages), "questionCount": len(questions),
            "answerSource": "使用者提供之公告試題 PDF 左側「答案」欄；依原檔抄錄，未另行推論或生成答案。",
        }
        checks = {
            "id": source_id, "pages": len(pdf.pages), "questions": len(questions), "continuations": continuation_count,
            "coverageRows": coverage_rows, "answerCounts": dict(sorted(Counter(coordinate_answers).items())),
            "imageBounds": sorted(image_bounds), "sourcePages": {q["number"]: q["sourcePages"] for q in questions if len(q["sourcePages"]) > 1},
        }
    # An independent PDF reader checks the file page count and 50 option sets.
    other = PdfReader(path)
    other_text = "\n".join(p.extract_text() or "" for p in other.pages)
    require(len(other.pages) == source["pages"], f"Independent page count: {source_id}")
    for letter in "ABCD":
        require(other_text.count(f"({letter})") == 50, f"Independent option count: {source_id} {letter}")
    return questions, source, checks


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild the 300-question bank from the six bundled PDFs.")
    parser.add_argument(
        "--source-dir", type=Path, default=PROJECT_ROOT / "sources",
        help="Directory containing the bundled short PDF names or original Chinese filenames (default: project/sources).",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=PROJECT_ROOT / "data",
        help="Directory for questions.json and sources.json (default: project/data).",
    )
    parser.add_argument("--report", type=Path, help="Optional path for a machine-readable validation report.")
    args = parser.parse_args()
    sources, questions, checks = [], [], []
    for round_number, subject, filename in FILES:
        short_name = f"115-r{round_number}-s{subject}.pdf"
        candidates = [args.source_dir / short_name, args.source_dir / filename]
        path = next((candidate for candidate in candidates if candidate.is_file()), None)
        require(path is not None, f"Missing authorized source: {short_name} or {filename} in {args.source_dir}")
        source_id = f"115-{round_number}-{subject}"
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        require(actual_hash == EXPECTED_SHA256[source_id], f"Source version/hash mismatch: {path.name}")
        batch, source, check = extract_file(path, round_number, subject, filename)
        sources.append(source)
        questions.extend(batch)
        checks.append(check)
    require(len(questions) == 300 and len({q["id"] for q in questions}) == 300, "Expected 300 unique questions")
    # All source versions and extraction checks must pass before writing JSON.
    # Source PDFs are only read, never copied or modified by this script.
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "questions.json").write_text(json.dumps({"version": "115-2026-v1", "questions": questions}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.output_dir / "sources.json").write_text(json.dumps({"sources": sources}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(checks, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for check in checks:
        print(f"{check['id']}: {check['questions']} questions; {check['pages']} pages; {check['continuations']} continued rows; answers {check['answerCounts']}")
    print("PASS: 300 unique questions, 1,200 options, 300 source answers; complete body-character coverage; all source hashes verified.")


if __name__ == "__main__":
    main()
