# Changelog & Release Notes

All notable changes to the **Tuition Ledger Management (Atlas400)** project are documented in this file.

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
