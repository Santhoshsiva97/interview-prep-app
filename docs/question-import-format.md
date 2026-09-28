# Question bulk-import format (v1)

The contract for loading questions into the Interview Prep Portal question bank
(FRD §4.11). The Content Acquisition Tool and any other source should produce
files in this format.

- **Endpoint:** `POST /api/v1/admin/question-imports` (multipart/form-data, field `file`)
- **Auth:** Bearer access token of an **editor**, **admin** or **super admin**
- **Files:** `.json` or `.csv`, UTF-8 (a BOM is fine), **≤ 5 MB**, **≤ 1000 questions**
- **Query options** (all `true`/`false`, default `false`):

| Option | Effect |
|---|---|
| `dryRun` | Validate and report only; nothing is written |
| `createMissingTaxonomy` | Create topics/tags that don't exist yet (otherwise such rows fail) |
| `submitForReview` | Put created/changed questions straight into the review queue |

Sample files: `GET /api/v1/admin/question-imports/template?format=json|csv`, and
[`db/seed/questions.sample.json`](../db/seed/questions.sample.json) (12 real questions).

## Behaviour

- **Per-row validation.** Valid rows are imported; invalid rows are skipped and reported.
  One bad row never blocks the rest.
- **Idempotent upserts by `externalId`.** A row whose `externalId` already exists updates
  that question. If the content is identical nothing happens (`unchanged`). Otherwise a new
  immutable version is created and the question goes back to `draft` (or `pending_review`
  with `submitForReview`); the previously published version stays live until an admin
  approves the new one. Rows without `externalId` always create new questions.
- `externalId` must be unique within a file, ≤ 120 chars, and can't switch a question's
  `type`. Archived questions must be restored before they can be re-imported.
- New questions are never published directly. An admin approves them in the UI.
- Imports are recorded (who, when, counts, per-row errors); dry runs are not.

## JSON

Either an array of questions or `{ "questions": [ ... ] }` (other top-level keys are ignored).

```jsonc
{
  "questions": [
    {
      "externalId": "cat-arrays-0001",      // optional, recommended: your stable id
      "type": "mcq",                        // "mcq" | "coding"
      "title": "Time complexity of binary search",   // 3–200 chars
      "body": "What is the worst-case ...",           // Markdown, 1–20000 chars
      "topic": "arrays-and-hashing",        // topic slug or name (case-insensitive)
      "difficulty": "easy",                 // "easy" | "medium" | "hard"
      "tags": ["binary-search", "company:Amazon"],   // optional, ≤ 20; "company:" prefix = company tag
      "explanation": "Each step halves ...", // optional, ≤ 10000 chars, Markdown
      "marks": 1,                            // optional, 1–100, default 1
      "mcq": {                               // required for mcq
        "allowMultiple": false,              // default false → exactly one correct option
        "options": [                         // 2–8 options, distinct texts, ≥ 1 correct
          { "text": "O(1)", "isCorrect": false },
          { "text": "O(log n)", "isCorrect": true }
        ]
      }
    },
    {
      "externalId": "cat-strings-0001",
      "type": "coding",
      "title": "Reverse words in a sentence",
      "body": "Given a line of text, print ...",
      "topic": "strings",
      "difficulty": "easy",
      "marks": 10,
      "coding": {                            // required for coding
        "timeLimitMs": 2000,                 // optional, 100–10000, default 2000
        "memoryLimitMb": 256,                // optional, 16–1024, default 256
        "starterCode": {                     // optional; python | javascript | java | cpp
          "python": "line = input()\n"
        },
        "testCases": [                       // 1–100; ≥ 1 sample AND ≥ 1 hidden
          { "input": "hello world", "expectedOutput": "world hello", "isSample": true },
          { "input": "a b c", "expectedOutput": "c b a", "isSample": false, "weight": 2 }
        ]                                    // input/expectedOutput ≤ 64 KB each; weight 1–100 (default 1)
      }
    }
  ]
}
```

Programs read **stdin** and write **stdout**; each test case's output is compared with
`expectedOutput` (exact comparison rules, e.g. trailing-whitespace handling, are defined by the
code judge in Step 8).

## CSV

Header row required (column names are case-insensitive; unknown columns are ignored).
At minimum: `type,title,body,topic,difficulty`. Full column set:

```
external_id,type,title,body,topic,difficulty,tags,explanation,marks,
option_1,option_2,option_3,option_4,option_5,option_6,option_7,option_8,correct,allow_multiple,
time_limit_ms,memory_limit_mb,starter_code,test_cases
```

| Column | Notes |
|---|---|
| `tags` | Pipe-separated: `hashing|company:Google` |
| `option_1`…`option_8` | MCQ options (blank = unused) |
| `correct` | Option number(s): `2`, or `"1,3"` / `1|3` for several. Several numbers imply `allow_multiple` |
| `allow_multiple` | `true`/`false` (optional) |
| `starter_code` | JSON object, e.g. `{"python": "x = input()\n"}` |
| `test_cases` | JSON array in the same shape as the JSON format's `testCases` |

Quote any cell containing commas, quotes or newlines (standard RFC 4180: `"a ""quoted"" word"`).
CSV suits MCQs; for coding questions JSON is easier to produce.

## How coding answers are judged

(Compatible addition, Step 8.) Candidate programs read the test case's `input` from **stdin** and write to **stdout**.
Output is compared with `expectedOutput` after normalising line endings and ignoring trailing whitespace on each line and
trailing blank lines. Every test case (sample and hidden) runs with the question's `timeLimitMs` / `memoryLimitMb`, scaled
per language (Python ×3 time, JavaScript ×2 time + 64 MB, Java ×2 time + 128 MB, C++ as given; capped at 15 s / 512 MB).
Java code must declare `public class Main`. `weight` sets each test's share of the marks when the exam allows partial credit.

## Response (`201`)

```jsonc
{
  "importId": "uuid | null (dry run)",
  "dryRun": false,
  "format": "json",
  "fileName": "batch-42.json",
  "totalRows": 3, "created": 1, "updated": 1, "unchanged": 0, "failed": 1,
  "newTaxonomy": { "topics": [], "tags": ["company:Acme"] },
  "rows": [
    { "row": 1, "externalId": "cat-1", "title": "...", "action": "create", "questionId": "uuid", "errors": [] },
    { "row": 2, "externalId": "cat-2", "title": "...", "action": "update", "questionId": "uuid", "errors": [] },
    { "row": 3, "externalId": "cat-3", "title": "...", "action": "error",
      "errors": [ { "field": "mcq.options", "message": "Mark at least one option as correct" } ] }
  ]
}
```

`row` is 1-based: the array index for JSON, the file line number (header = line 1) for CSV.
In a dry run, `action` is `create` or `update` (whether content changed is only known on the
real run). A whole-file problem (bad JSON/CSV, no rows, > 1000 rows) returns
`400 INVALID_IMPORT_FILE`; a wrong file type returns `400 UNSUPPORTED_FILE_TYPE`; > 5 MB returns
`413 FILE_TOO_LARGE`.
