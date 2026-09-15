import { buildStudentUPSCHierarchy } from "../src/utils/studentUPSCHierarchyHelper";
import { Student, ClassNote } from "../src/types";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

const mockStudent: Student = {
  id: "student_upsc_1",
  name: "UPSC Aspirant",
  classGrade: "UPSC",
  enrolledSubjects: ["General Studies Paper II"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

console.log("=================================================");
console.log("TESTING UPSC STUDENT HIERARCHY DATA-VISIBILITY");
console.log("=================================================");

// CASE 1: No UPSC topic notes exist.
console.log("\n[CASE 1] No UPSC topic notes exist");
const res1 = buildStudentUPSCHierarchy(mockStudent, []);
assert(res1.length === 0, "Student hierarchy is completely empty when 0 topic notes exist (no empty modules/subjects)");

// CASE 2: One topic note exists in Module 2 (Historical Underpinnings)
console.log("\n[CASE 2] One topic note exists in Module 2 (Module 1 has 0 notes)");
const noteMod2: ClassNote = {
  id: "note_mod2_topic1",
  classGrade: "UPSC",
  subject: "Constitution",
  paper: "General Studies Paper II",
  moduleNo: 2,
  moduleName: "Historical Underpinnings",
  topicNo: 1,
  topicName: "Colonial Constitutional Developments",
  pdfFileName: "colonial_dev.pdf",
  pdfUrl: "https://example.com/colonial_dev.pdf",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  chapterNo: 2,
  chapterName: "Historical Underpinnings",
};

const res2 = buildStudentUPSCHierarchy(mockStudent, [noteMod2]);
assert(res2.length === 1, "Exactly 1 GS Paper returned");
assert(res2[0].gsPaper === "General Studies Paper II", "Paper is General Studies Paper II");
assert(res2[0].totalSubjects === 1, "Paper totalSubjects is 1");
assert(res2[0].totalModules === 1, "Paper totalModules is 1");
assert(res2[0].totalTopics === 1, "Paper totalTopics is 1");

const subj2 = res2[0].subjects[0];
assert(subj2.subject === "Constitution", "Subject is Constitution");
assert(subj2.totalModules === 1, "Subject totalModules is 1");
assert(subj2.totalTopics === 1, "Subject totalTopics is 1");
assert(subj2.modules.length === 1, "Subject contains exactly 1 module");
assert(subj2.modules[0].moduleNo === 2, "Module number is 2 (Module 1 is NOT present)");
assert(subj2.modules[0].topics.length === 1, "Module 2 has 1 topic note");
assert(subj2.modules[0].topics[0].id === "note_mod2_topic1", "Topic note ID matches");

// CASE 3: Multiple topic notes exist across multiple modules
console.log("\n[CASE 3] Multiple topic notes exist across multiple modules (Module 1 has note, Module 2 has 2 notes, Module 3 has 0 notes)");
const noteMod1: ClassNote = {
  id: "note_mod1_topic1",
  classGrade: "UPSC",
  subject: "Constitution",
  paper: "General Studies Paper II",
  moduleNo: 1,
  moduleName: "Strategy",
  topicNo: 1,
  topicName: "Syllabus Breakdown",
  pdfFileName: "strategy.pdf",
  pdfUrl: "https://example.com/strategy.pdf",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  chapterNo: 1,
  chapterName: "Strategy",
};

const noteMod2b: ClassNote = {
  id: "note_mod2_topic2",
  classGrade: "UPSC",
  subject: "Constitution",
  paper: "General Studies Paper II",
  moduleNo: 2,
  moduleName: "Historical Underpinnings",
  topicNo: 2,
  topicName: "Constituent Assembly Debates",
  pdfFileName: "cad.pdf",
  pdfUrl: "https://example.com/cad.pdf",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  chapterNo: 2,
  chapterName: "Historical Underpinnings",
};

let currentNotes = [noteMod1, noteMod2, noteMod2b];
const res3 = buildStudentUPSCHierarchy(mockStudent, currentNotes);
assert(res3[0].subjects[0].modules.length === 2, "Exactly 2 modules appear (Module 1 and Module 2; Module 3 does not appear)");
assert(res3[0].totalModules === 2, "Total modules count is 2");
assert(res3[0].totalTopics === 3, "Total topics count is 3");

// CASE 4: Admin deletes one of several topic notes (delete noteMod2b)
console.log("\n[CASE 4] Admin deletes one topic note from Module 2");
currentNotes = currentNotes.filter((n) => n.id !== "note_mod2_topic2");
const res4 = buildStudentUPSCHierarchy(mockStudent, currentNotes);
assert(res4[0].subjects[0].modules.length === 2, "Still 2 modules appear");
assert(res4[0].subjects[0].modules.find((m) => m.moduleNo === 2)?.topics.length === 1, "Module 2 now has 1 topic note");
assert(res4[0].totalTopics === 2, "Total topics count decreased to 2");

// CASE 5: Admin deletes the last topic note in Module 1
console.log("\n[CASE 5] Admin deletes the last topic note in Module 1");
currentNotes = currentNotes.filter((n) => n.id !== "note_mod1_topic1");
const res5 = buildStudentUPSCHierarchy(mockStudent, currentNotes);
assert(res5[0].subjects[0].modules.length === 1, "Module 1 completely disappeared; only 1 module remains");
assert(res5[0].subjects[0].modules[0].moduleNo === 2, "Remaining module is Module 2");
assert(res5[0].totalModules === 1, "Total modules count is 1");
assert(res5[0].totalTopics === 1, "Total topics count is 1");

// CASE 6: Admin deletes the last topic note in Constitution subject
console.log("\n[CASE 6] Admin deletes the last topic note in Constitution subject");
currentNotes = currentNotes.filter((n) => n.id !== "note_mod2_topic1");
const res6 = buildStudentUPSCHierarchy(mockStudent, currentNotes);
assert(res6.length === 0, "Constitution subject disappeared because it had 0 notes; GS Paper II also disappeared");

// CASE 7: Subject with 0 notes in paper results in empty state
console.log("\n[CASE 7] Admin deletes last topic note in GS Paper -> Empty State");
assert(res6.length === 0, "No papers returned -> UI displays empty state");

// CASE 8: A note exists but is unpublished, draft, deleted, or hidden
console.log("\n[CASE 8] Note exists but is unpublished, draft, deleted, or hidden");
const draftNote: ClassNote = {
  ...noteMod1,
  id: "draft_note_1",
  isDraft: true,
};
const res8a = buildStudentUPSCHierarchy(mockStudent, [draftNote]);
assert(res8a.length === 0, "Draft note does not appear to student");

const unpubNote: ClassNote = {
  ...noteMod1,
  id: "unpub_note_1",
  isPublished: false,
};
const res8b = buildStudentUPSCHierarchy(mockStudent, [unpubNote]);
assert(res8b.length === 0, "Unpublished note (isPublished: false) does not appear to student");

const hiddenNote: ClassNote = {
  ...noteMod1,
  id: "hidden_note_1",
  visibility: "hidden",
};
const res8c = buildStudentUPSCHierarchy(mockStudent, [hiddenNote]);
assert(res8c.length === 0, "Hidden note (visibility: hidden) does not appear to student");

const selectedAccessNote: ClassNote = {
  ...noteMod1,
  id: "selected_note_1",
  accessType: "selected",
  allowedStudentIds: ["other_student_id"],
};
const res8d = buildStudentUPSCHierarchy(mockStudent, [selectedAccessNote]);
assert(res8d.length === 0, "Note with selected access for another student does not appear to student");

console.log("\n=================================================");
console.log("✨ ALL 8 CASES PASSED WITH 100% SUCCESS!");
console.log("=================================================");
