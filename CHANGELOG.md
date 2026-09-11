# Changelog & Release Notes

All notable changes to the **Tuition Ledger Management (Atlas400)** project are documented in this file.

---

## [7.12.0] - 2026-09-11

### 📚 Dedicated CBSE Chapter Test Parser Implementation
- **Comprehensive 9 Question Types Architecture:**
  - Implemented `parseChapterTest` in `src/lib/testParser.ts` supporting 9 distinct categories without merging:
    1. Multiple Choice Questions (MCQs)
    2. Multiple Select Questions
    3. Assertion and Reasoning
    4. Comprehension (Parent passages with structured child questions)
    5. True and False
    6. Very Short Answer Questions
    7. Short Answer Questions
    8. Long Answer Questions
    9. Case-Based Questions (Case studies with structured child questions)
- **Arbitrary Section Identification & Instructions:**
  - Identified sections using varied headings ("Section A — Multiple Choice Questions", "Section B — Multiple Select Questions", numbered sections, etc.).
  - Preserved section-level instructions (e.g. Directions for MSQs and Assertion/Reasoning) and general test instructions.
- **Passage-Child Relationship & Structure:**
  - Built passage and case-study structures linking parent passages (`passagesMap` / `casesMap`) to child questions without classifying passages as single MCQs.
  - Retained all options without truncation or omission.
- **Dynamic Marks Calculation & Strict Validation:**
  - Calculated section total marks, question-level marks, and test-level marks.
  - Performed consistency verification between declared total marks and calculated question marks, reporting discrepancies in warnings without dropping questions.
- **Full Backward Compatibility:**
  - Provided `convertToAssessmentQuestions` adapter for seamless integration with existing `AdminPracticeTestModal` and assessment components.

---

## [7.11.0] - 2026-09-11

### 📝 Assessment Parser Hardening & Flexible Assessment Ingestion
- **Resilient Numbering & Checkmark Support:**
  - Enhanced `matchQuestionHeader` and block segmentation to reliably parse varied question numbering styles (`1.`, `2)`, `15:`, `30.`).
  - Stripped extraneous checkmarks and status markers (`✅`, `❌`, `(correct)`, `(trap)`) while preserving explicit correct answers.
- **Section vs. Question Lookahead Disambiguation:**
  - Implemented `isSectionHeaderWithLookahead` to distinguish between standalone section markers (e.g. `2. True / False` followed by question headers) and inline numbered questions (e.g. `30. True / False` followed directly by statement text).
- **Fault-Tolerant Question Ingestion:**
  - Handled malformed question blocks gracefully without failing the entire assessment import, reporting clear warnings while importing all valid questions.
  - Added robust validation for comprehension passages, linked passage questions, Assertion & Reasoning formats, and True/False questions.
- **Full Test Suite & Verification:**
  - Added test cases covering comprehension passages, mixed question formats, and edge-case layouts in `src/utils/assessmentParser.test.ts`.

---

## [5.2.1] - 2026-08-27

### 🎯 Persistent Topic Test Synchronization & Real-Time Sync
- **Firestore Single Source of Truth:**
  - Guaranteed permanent storage of all created and uploaded practice tests within the Firestore `topic_practice_tests` collection.
  - Implemented non-destructive `{ merge: true }` writes with comprehensive metadata (`testId`, `hasTest`, `hasPracticeTest`, question arrays, and timestamps).
  - Synchronized test presence metadata (`hasPracticeTest`, `hasTest`, `practiceTestId`) directly onto associated class and UPSC note records.
- **Immediate Admin → Student Real-Time Sync:**
  - Real-time `onSnapshot` subscriptions and broadcast event listeners across admin and student portals.
  - Instant appearance and synchronization of newly created or updated practice tests across student devices without manual refresh.
- **Topic Test Visibility & Access Fixes:**
  - Resolved practice test visibility across `StudentSchoolTree`, `StudentUPSCTree`, `SubjectNotes`, and `AdminNotesDashboard`.
  - Added multi-key matching algorithms to reliably pair tests with notes using normalized class, subject, chapter/module, and topic labels.
- **Student Study Space Improvements:**
  - Instant loading and launch of topic assessments directly from the interactive tree and subject notes cards.
  - Enhanced student attempt persistence, score tracking, and auto-graded results feedback.
- **Auto-Sync & App Lifecycle Hydration:**
  - Proactive database hydration on application launch (`App.tsx`) and authentication session recovery.
  - Persistent caching and zero-loss state retention during browser refreshes, logouts, and tab switching.
- **Upload Reliability & Storage Hardening:**
  - Atomic question updates and robust image upload linking to cloud storage with specific question IDs.
  - Graceful cleanup and non-destructive unlinking when tests or questions are removed.

---

## [5.1.0] - 2026-08-27

### 🚀 Major Hierarchy & Terminology Refactor
- **Strict Terminology Separation:**
  - **School (Classes 6–12):** Standardized on **"Chapter" / "Chapters"** across all interfaces (Admin Console, Student Console, Tree Navigators, Modals, Breadcrumbs, and Search).
  - **UPSC:** Preserved **"Module" / "Modules"** for General Studies Papers (GS1–GS4, Optional, Prelims/Mains).
- **Hierarchical 4-Tier Architecture:**
  - **School Hierarchy:** `Class (6–12) → Subject → Chapter → Topic Note`
  - **UPSC Hierarchy:** `General Studies Paper → Subject → Module → Topic Note`

### 🧹 Notes & Storage Cleanup
- **Existing Notes Purge:**
  - Removed all legacy and demo uploaded Topic Notes, PDFs, and image files from Cloudflare R2 storage.
  - Cleared Topic Note database records and metadata in Firestore (`class_notes`, `upsc_notes`).
  - Cleansed all student notes references and test associations to start with a fresh, clean state.
  - Preserved all Subjects, School Chapters, and UPSC Modules in curriculum configuration.

### ⚡ Performance & Synchronization Enhancements
- **Intelligent IndexedDB Caching:** `notesCacheService` provides instant, flicker-free rendering of topic notes and metadata.
- **Bi-directional Real-Time Sync:** Unified synchronization layer (`appSync`, `curriculumService`) ensuring zero data loss and immediate multi-tab updates.
- **Optimized Tree Navigation:** Redesigned `StudentSchoolTree` and `StudentUPSCTree` with collapsible sections, search filters, and progress tracking.

---

## [5.0.9] - 2026-08-26

- Hardened Cloudflare R2 storage upload and replacement pipelines with exponential retry backoff.
- Integrated native PDF viewing and offline file caching.
- Enhanced practice test question generation and attempt logging.

---

## [5.0.8] - 2026-08-25

- Initial implementation of the 4-tier notes hierarchy.
- Unified Firestore `curriculum_hierarchy` schema with zero-loss fallback.
