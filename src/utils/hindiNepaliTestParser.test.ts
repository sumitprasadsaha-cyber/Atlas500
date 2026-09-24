import test from "node:test";
import assert from "node:assert/strict";
import { parseUniversalTestText } from "./universalTestParser";
import { parseAssessmentText } from "./assessmentParser";
import { parseChapterTest } from "../lib/testParser";

const mockContext = {
  classGrade: "कक्षा 10",
  subject: "हिंदी",
  chapterNo: 1,
  chapterName: "व्याकरण एवं साहित्य",
  topicName: "शब्द विचार एवं रचनात्मक लेखन"
};

const hindi25Mark15QuestionPaper = `
कक्षा 10 — हिंदी
पाठ: व्याकरण एवं रचनात्मक लेखन
पूर्णांक: 25
समय: 1 घंटा

खण्ड क — बहुविकल्पीय प्रश्न (5 × 1 = 5 अंक)

प्रश्न 1. ‘सुंदर’ शब्द का विलोम क्या है?
A. अच्छा
B. कुरूप
C. मधुर
D. सरल
उत्तर: B. कुरूप

प्रश्न 2. ‘जल’ का पर्यायवाची शब्द कौन-सा है?
A. अग्नि
B. पवन
C. नीर
D. धरा
उत्तर: C. नीर

प्रश्न 3. ‘सूर्योदय’ शब्द का सही संधि-विच्छेद क्या है?
(क) सूर्य + उदय
(ख) सूर्य + दय
(ग) सुर्य + उदय
(घ) सू + उदय
उत्तर: (क) सूर्य + उदय

प्रश्न 4. ‘आँखों का तारा होना’ मुहावरे का क्या अर्थ है?
A. बहुत प्यारा होना
B. कम दिखाई देना
C. घमंडी होना
D. दूर रहना
उत्तर: A. बहुत प्यारा होना

प्रश्न 5. निम्नलिखित में से शुद्ध वर्तनी वाला शब्द छाँटिए:
A. उज्जवल
B. उज्ज्वल
C. उज्वल
D. उजवल
उत्तर: B. उज्ज्वल

खण्ड ख — कथन एवं कारण (2 × 1 = 2 अंक)

प्रश्न 6.
कथन (A): कबीरदास जी समाज-सुधारक कवि थे।
कारण (R): उन्होंने अपनी रचनाओं में सामाजिक कुरीतियों एवं बाह्याडंबरों का कड़ा विरोध किया।
A. कथन (A) और कारण (R) दोनों सही हैं तथा कारण (R) कथन (A) की सही व्याख्या है।
B. कथन (A) और कारण (R) दोनों सही हैं परंतु कारण (R) कथन (A) की सही व्याख्या नहीं है।
C. कथन (A) सही है परंतु कारण (R) गलत है।
D. कथन (A) गलत है परंतु कारण (R) सही है।
उत्तर: A

प्रश्न 7.
कथन (A): संज्ञा के पाँच भेद माने जाते हैं।
कारण (R): व्यक्तिवाचक संज्ञा से किसी विशेष व्यक्ति, वस्तु या स्थान का बोध होता है।
A. कथन (A) और कारण (R) दोनों सही हैं तथा कारण (R) कथन (A) की सही व्याख्या है।
B. कथन (A) और कारण (R) दोनों सही हैं परंतु कारण (R) कथन (A) की सही व्याख्या नहीं है।
C. कथन (A) सही है परंतु कारण (R) गलत है।
D. कथन (A) गलत है परंतु कारण (R) सही है।
उत्तर: B

खण्ड ग — सही या गलत (2 × 1 = 2 अंक)

प्रश्न 8. ‘हिमालय’ एक व्यक्तिवाचक संज्ञा शब्द है।
उत्तर: सही

प्रश्न 9. क्रिया के बिना कोई भी वाक्य पूर्ण हो सकता है।
उत्तर: गलत

खण्ड घ — अति लघु उत्तरीय प्रश्न (2 × 1 = 2 अंक)

प्रश्न 10. ‘अनुराग’ शब्द का विलोम शब्द लिखिए। [1 अंक]
उत्तर: ‘अनुराग’ का विलोम शब्द ‘विराग’ होता है।

प्रश्न 11. भाषा की सबसे छोटी इकाई को क्या कहते हैं? [1 अंक]
उत्तर: भाषा की सबसे छोटी इकाई को ‘वर्ण’ कहते हैं।

खण्ड ङ — लघु उत्तरीय प्रश्न (2 × 2 = 4 अंक)

प्रश्न 12. संवाद लेखन: दो मित्रों के बीच परीक्षा की तैयारी को लेकर हुई बातचीत को लगभग 50 शब्दों में लिखिए। [2 अंक]
उत्तर:
रोहन: नमस्ते सोहन! तुम्हारी परीक्षा की तैयारी कैसी चल रही है?
सोहन: नमस्ते रोहन! मेरी तैयारी बहुत अच्छी चल रही है।

प्रश्न 13. उपसर्ग और प्रत्यय में मुख्य अंतर उदाहरण सहित स्पष्ट कीजिए। [2 अंक]
अथवा
पर्यायवाची और विलोम शब्द की परिभाषा उदाहरण सहित लिखिए।
उत्तर: उपसर्ग शब्द के आरंभ में जुड़कर उसका अर्थ बदलते हैं, जबकि प्रत्यय शब्द के अंत में जुड़ते हैं।

खण्ड च — दीर्घ उत्तरीय प्रश्न (2 × 5 = 10 अंक)

प्रश्न 14. पत्र लेखन: अपने विद्यालय के प्रधानाचार्य को दो दिन के अवकाश हेतु प्रार्थना-पत्र लिखिए। [5 अंक]
अथवा
अपने मित्र को उसके जन्मदिन पर बधाई देते हुए एक पत्र लिखिए।
उत्तर:
सेवा में,
प्रधानाचार्य महोदय,
केंद्रीय विद्यालय।
महोदय,
सविनय निवेदन है कि मुझे दो दिन का अवकाश प्रदान करने की कृपा करें।

प्रश्न 15. अनुच्छेद लेखन: ‘समय का सदुपयोग’ विषय पर 100-120 शब्दों में एक अनुच्छेद लिखिए। [5 अंक]
अथवा
‘पर्यावरण संरक्षण’ विषय पर एक परिच्छेद लिखिए।
उत्तर: समय संसार की सबसे मूल्यवान वस्तु है। बीता हुआ समय कभी वापस नहीं आता।
`;

test("Hindi 25-mark test with 15 questions parsed correctly via parseChapterTest", () => {
  const result = parseChapterTest(hindi25Mark15QuestionPaper);

  assert.equal(result.questions.length, 15, "Must parse all 15 questions");
  assert.equal(result.validation.questionCount, 15);

  // Q1: सुंदर शब्द का विलोम
  const q1 = result.questions[0];
  assert.equal(q1.questionNumber, 1);
  assert.ok(q1.question.includes("‘सुंदर’"));
  assert.ok(q1.question.includes("विलोम"));
  assert.equal(q1.options.length, 4);
  assert.equal(q1.correctAnswer, "B");
  assert.equal(q1.marks, 1);

  // Q2: जल का पर्यायवाची
  const q2 = result.questions[1];
  assert.equal(q2.questionNumber, 2);
  assert.ok(q2.question.includes("‘जल’"));
  assert.ok(q2.question.includes("पर्यायवाची"));
  assert.equal(q2.correctAnswer, "C");
  assert.equal(q2.marks, 1);

  // Q3: सूर्योदय (क), (ख) options
  const q3 = result.questions[2];
  assert.equal(q3.questionNumber, 3);
  assert.ok(q3.question.includes("‘सूर्योदय’"));
  assert.equal(q3.correctAnswer, "A");
  assert.equal(q3.marks, 1);

  // Q4: आँखों का तारा
  const q4 = result.questions[3];
  assert.equal(q4.correctAnswer, "A");
  assert.equal(q4.marks, 1);

  // Q5: शुद्ध वर्तनी
  const q5 = result.questions[4];
  assert.equal(q5.correctAnswer, "B");
  assert.equal(q5.marks, 1);

  // Q6: Assertion Reason
  const q6 = result.questions[5];
  assert.equal(q6.type, "assertion_reason");
  assert.ok(q6.assertionText?.includes("कबीरदास") || q6.question.includes("कबीरदास"));
  assert.equal(q6.correctAnswer, "A");
  assert.equal(q6.marks, 1);

  // Q7: Assertion Reason
  const q7 = result.questions[6];
  assert.equal(q7.type, "assertion_reason");
  assert.equal(q7.correctAnswer, "B");
  assert.equal(q7.marks, 1);

  // Q8: True/False
  const q8 = result.questions[7];
  assert.equal(q8.type, "true_false");
  assert.equal(q8.correctAnswer, "True");
  assert.equal(q8.marks, 1);

  // Q9: True/False
  const q9 = result.questions[8];
  assert.equal(q9.type, "true_false");
  assert.equal(q9.correctAnswer, "False");
  assert.equal(q9.marks, 1);

  // Q10: Very Short Answer (Question 10 prefix)
  const q10 = result.questions[9];
  assert.equal(q10.questionNumber, 10);
  assert.equal(q10.type, "very_short_answer");
  assert.ok(q10.question.includes("‘अनुराग’"));
  assert.ok(q10.modelAnswer?.includes("विराग"));
  assert.equal(q10.marks, 1);

  // Q11: Very Short Answer
  const q11 = result.questions[10];
  assert.equal(q11.questionNumber, 11);
  assert.equal(q11.type, "very_short_answer");
  assert.ok(q11.modelAnswer?.includes("वर्ण"));
  assert.equal(q11.marks, 1);

  // Q12: Short Answer (संवाद लेखन)
  const q12 = result.questions[11];
  assert.equal(q12.questionNumber, 12);
  assert.equal(q12.type, "short_answer");
  assert.ok(q12.question.includes("संवाद लेखन"));
  assert.equal(q12.marks, 2);

  // Q13: Short Answer (with अथवा)
  const q13 = result.questions[12];
  assert.equal(q13.questionNumber, 13);
  assert.equal(q13.type, "short_answer");
  assert.ok(q13.question.includes("उपसर्ग"));
  assert.ok(q13.question.includes("अथवा"));
  assert.equal(q13.marks, 2);

  // Q14: Long Answer (पत्र लेखन with अथवा)
  const q14 = result.questions[13];
  assert.equal(q14.questionNumber, 14);
  assert.equal(q14.type, "long_answer");
  assert.ok(q14.question.includes("पत्र लेखन"));
  assert.ok(q14.question.includes("अथवा"));
  assert.equal(q14.marks, 5);

  // Q15: Long Answer (अनुच्छेद लेखन with अथवा)
  const q15 = result.questions[14];
  assert.equal(q15.questionNumber, 15);
  assert.equal(q15.type, "long_answer");
  assert.ok(q15.question.includes("अनुच्छेद लेखन"));
  assert.ok(q15.question.includes("अथवा"));
  assert.equal(q15.marks, 5);

  // Total calculated marks must be exactly 25
  const totalMarks = result.questions.reduce((sum, q) => sum + (q.marks || 0), 0);
  assert.equal(totalMarks, 25, "Total marks must equal 25");
});

test("Hindi 25-mark test with 15 questions parsed correctly via parseAssessmentText", () => {
  const result = parseAssessmentText(hindi25Mark15QuestionPaper, mockContext);

  assert.equal(result.success, true);
  assert.equal(result.questions.length, 15, "Must parse all 15 questions");

  // Verify Hindi Unicode preservation (danda, matras, single quotes)
  assert.ok(result.questions[0].question.includes("‘सुंदर’"));
  assert.ok(result.questions[0].question.includes("विलोम"));
  assert.equal(result.questions[0].correctAnswer, "B");

  assert.ok(result.questions[1].question.includes("‘जल’"));
  assert.equal(result.questions[1].correctAnswer, "C");

  // True/False
  assert.equal(result.questions[7].type, "true_false");
  assert.equal(result.questions[7].correctAnswer, "True");
  assert.equal(result.questions[8].type, "true_false");
  assert.equal(result.questions[8].correctAnswer, "False");

  // Q10
  assert.equal(result.questions[9].questionNumber, 10);
  assert.equal(result.questions[9].type, "very_short_answer");

  // Total marks sum
  const total = result.questions.reduce((sum, q) => sum + (q.marks || 0), 0);
  assert.equal(total, 25, "Total marks must be 25");
});

test("Hindi 25-mark test with 15 questions parsed correctly via parseUniversalTestText", () => {
  const result = parseUniversalTestText(hindi25Mark15QuestionPaper, mockContext);

  assert.equal(result.success, true);
  assert.equal(result.questions.length, 15, "Must parse all 15 questions");

  assert.ok(result.questions[0].question.includes("‘सुंदर’"));
  assert.equal(result.questions[0].correctAnswer, "B");
  assert.equal(result.questions[1].correctAnswer, "C");

  // Q10
  assert.equal(result.questions[9].questionNumber, "10");
  assert.equal(result.questions[9].type, "very_short_answer");

  // Total marks
  const total = result.questions.reduce((sum, q) => sum + (q.marks || 0), 0);
  assert.equal(total, 25, "Total marks must be 25");
});

test("Nepali support: parses Devanagari questions, answers, and options accurately", () => {
  const nepaliPaper = `
विषय: नेपाली
कक्षा: १०
पूर्णांक: १०

खण्ड क — बहुविकल्पीय प्रश्न

प्रश्न १. नेपालको राजधानी कुन सहर हो?
A. पोखरा
B. काठमाडौं
C. धरान
D. विराटनगर
उत्तर: B. काठमाडौं

प्रश्न २. ‘आकाश’ शब्दको पर्यायवाची शब्द कुन हो?
(क) पाताल
(ख) गगन
(ग) धर्ती
(घ) सागर
उत्तर: (ख) गगन

खण्ड ख — ठीक वा बेठीक

प्रश्न ३. सगरमाथा संसारको सर्वोच्च शिखर हो।
उत्तर: ठीक

प्रश्न ४. पृथ्वी स्थिर छ र सूर्यले पृथ्वीलाई परिक्रमा गर्छ।
उत्तर: बेठीक

खण्ड ग — संक्षिप्त उत्तर (अथवा विकल्प सहित)

प्रश्न ५. वातावरण संरक्षणका कुनै दुई उपायहरू लेख्नुहोस्। [२ अंक]
वा
वृक्षारोपणको महत्त्व छोटकरीमा बताउनुहोस्।
उत्तर: १. रुख रोप्ने, २. प्रदूषण नियन्त्रण गर्ने।
`;

  const result = parseChapterTest(nepaliPaper);

  assert.equal(result.questions.length, 5);
  // Nepali numeral question 1
  assert.equal(result.questions[0].questionNumber, 1);
  assert.ok(result.questions[0].question.includes("नेपालको राजधानी"));
  assert.equal(result.questions[0].correctAnswer, "B");

  // Question 2
  assert.equal(result.questions[1].questionNumber, 2);
  assert.ok(result.questions[1].question.includes("‘आकाश’"));
  assert.equal(result.questions[1].correctAnswer, "B");

  // True/False with ठीक and बेठीक
  assert.equal(result.questions[2].type, "true_false");
  assert.equal(result.questions[2].correctAnswer, "True");

  assert.equal(result.questions[3].type, "true_false");
  assert.equal(result.questions[3].correctAnswer, "False");

  // Subjective with वा (Nepali alternative)
  assert.equal(result.questions[4].questionNumber, 5);
  assert.ok(result.questions[4].question.includes("वातावरण"));
  assert.ok(result.questions[4].question.includes("वा"));
  assert.equal(result.questions[4].marks, 2);
});

test("Mixed-language test (English, Hindi, Nepali) parses seamlessly without cross-contamination", () => {
  const mixedText = `
1. What is the powerhouse of the cell?
A. Nucleus
B. Mitochondria
C. Ribosome
D. Chloroplast
Answer: B

प्रश्न 2. ‘अमृत’ का विलोम शब्द क्या है?
A. विष
B. जल
C. सुधा
D. पीयूष
उत्तर: A. विष

प्रश्न ३. नेपालको राष्ट्रिय फूल कुन हो?
A. गुराँस
B. सूर्यमुखी
C. कमल
D. चमेली
उत्तर: A. गुराँस
`;

  const parsed = parseChapterTest(mixedText);
  assert.equal(parsed.questions.length, 3);

  // English Q1
  assert.equal(parsed.questions[0].questionNumber, 1);
  assert.ok(parsed.questions[0].question.includes("powerhouse of the cell"));
  assert.equal(parsed.questions[0].correctAnswer, "B");

  // Hindi Q2
  assert.equal(parsed.questions[1].questionNumber, 2);
  assert.ok(parsed.questions[1].question.includes("‘अमृत’ का विलोम शब्द"));
  assert.equal(parsed.questions[1].correctAnswer, "A");

  // Nepali Q3
  assert.equal(parsed.questions[2].questionNumber, 3);
  assert.ok(parsed.questions[2].question.includes("नेपालको राष्ट्रिय फूल"));
  assert.equal(parsed.questions[2].correctAnswer, "A");
});

test("Phase 1: Full 9-section Hindi paper (खंड A to खंड I) with Devanagari options and multiline answers", () => {
  const hindi9SectionPaper = `
कक्षा 10 — हिंदी
पूर्णांक: 50
समय: 2 घंटे

खंड A — बहुविकल्पीय प्रश्न
प्रश्न 1. ‘सुंदर’ शब्द का विलोम क्या है?
A. अच्छा
B. कुरूप
C. मधुर
D. सरल
उत्तर: B. कुरूप

खंड B — एक से अधिक सही उत्तर
प्रश्न 2. निम्नलिखित में से कौन-से शब्द ‘सूर्य’ के पर्यायवाची हैं?
A. दिनकर
B. रजनी
C. भास्कर
D. राकेश
उत्तर: A, C

खंड C — कथन और कारण
प्रश्न 3.
कथन (A): कबीरदास जी समाज-सुधारक कवि थे।
कारण (R): उन्होंने अपनी रचनाओं में सामाजिक कुरीतियों का विरोध किया।
A. कथन (A) और कारण (R) दोनों सही हैं तथा कारण (R) कथन (A) की सही व्याख्या है।
B. कथन (A) और कारण (R) दोनों सही हैं परंतु कारण (R) कथन (A) की सही व्याख्या नहीं है।
C. कथन (A) सही है परंतु कारण (R) गलत है।
D. कथन (A) गलत है परंतु कारण (R) सही है।
उत्तर: A

खंड D — गद्यांश
सच्चा मित्र वही है जो विपत्ति के समय काम आए। मित्र के बिना जीवन सूना लगता है।
प्रश्न 4. सच्चा मित्र कौन होता है?
A. जो केवल सुख में साथ दे
B. जो विपत्ति के समय काम आए
C. जो धनवान हो
D. जो बातें बनाए
उत्तर: B

खंड E — सही या गलत
प्रश्न 5. ‘हिमालय’ एक व्यक्तिवाचक संज्ञा शब्द है।
उत्तर: सही

खंड F — अति लघु उत्तरीय प्रश्न
प्रश्न 6. ‘अनुराग’ शब्द का विलोम शब्द लिखिए। [1 अंक]
उत्तर: ‘अनुराग’ का विलोम शब्द ‘विराग’ होता है।

खंड G — लघु उत्तरीय प्रश्न
प्रश्न 7. उपसर्ग और प्रत्यय में मुख्य अंतर उदाहरण सहित स्पष्ट कीजिए। [2 अंक]
उत्तर: उपसर्ग शब्द के आरंभ में जुड़ते हैं जबकि प्रत्यय शब्द के अंत में जुड़ते हैं।

खंड H — लेखन
प्रश्न 8. संवाद लेखन: दो मित्रों के बीच परीक्षा की तैयारी को लेकर हुई बातचीत लिखिए। [5 अंक]
उत्तर:
रोहन: नमस्ते सोहन! तुम्हारी परीक्षा की तैयारी कैसी चल रही है?
सोहन: नमस्ते रोहन! मेरी तैयारी बहुत अच्छी चल रही है।
रोहन: बहुत बढ़िया! सफलता की शुभकामनाएँ।

खंड I — व्याकरण
प्रश्न 9. संधि की परिभाषा उदाहरण सहित दीजिए। [2 अंक]
उत्तर: दो वर्णों के परस्पर मेल से जो विकार उत्पन्न होता है, उसे संधि कहते हैं। जैसे: विद्या + आलय = विद्यालय।
`;

  const parsed = parseChapterTest(hindi9SectionPaper);

  // 1. Verify all 9 sections recognized
  assert.equal(parsed.sections.length, 9, "Must recognize all 9 sections (खंड A to खंड I)");
  assert.equal(parsed.sections[0].type, "mcq");
  assert.equal(parsed.sections[1].type, "multiple_select");
  assert.equal(parsed.sections[2].type, "assertion_reason");
  assert.equal(parsed.sections[3].type, "comprehension");
  assert.equal(parsed.sections[4].type, "true_false");
  assert.equal(parsed.sections[5].type, "very_short_answer");
  assert.equal(parsed.sections[6].type, "short_answer");
  assert.equal(parsed.sections[7].type, "long_answer");
  assert.equal(parsed.sections[8].type, "short_answer");

  // 2. Verify all 9 questions parsed
  assert.equal(parsed.questions.length, 9, "Must parse all 9 questions");

  // Q1: MCQ with Hindi options A. अच्छा, B. कुरूप, etc.
  const q1 = parsed.questions[0];
  assert.equal(q1.questionNumber, 1);
  assert.ok(q1.question.includes("‘सुंदर’"));
  assert.equal(q1.options.length, 4);
  assert.equal(q1.correctAnswer, "B");

  // Q2: Multiple Select with A, C
  const q2 = parsed.questions[1];
  assert.equal(q2.questionNumber, 2);
  assert.equal(q2.type, "multiple_select");
  assert.equal(q2.correctAnswer, "A, C");

  // Q3: Assertion Reason
  const q3 = parsed.questions[2];
  assert.equal(q3.questionNumber, 3);
  assert.equal(q3.type, "assertion_reason");
  assert.equal(q3.correctAnswer, "A");

  // Q4: Comprehension
  const q4 = parsed.questions[3];
  assert.equal(q4.questionNumber, 4);
  assert.equal(q4.correctAnswer, "B");

  // Q5: True/False
  const q5 = parsed.questions[4];
  assert.equal(q5.questionNumber, 5);
  assert.equal(q5.type, "true_false");
  assert.equal(q5.correctAnswer, "True");

  // Q6: Very Short Answer
  const q6 = parsed.questions[5];
  assert.equal(q6.questionNumber, 6);
  assert.equal(q6.type, "very_short_answer");
  assert.ok(q6.modelAnswer?.includes("विराग"));

  // Q7: Short Answer
  const q7 = parsed.questions[6];
  assert.equal(q7.questionNumber, 7);
  assert.equal(q7.type, "short_answer");
  assert.ok(q7.modelAnswer?.includes("उपसर्ग"));

  // Q8: Writing with multiline answer
  const q8 = parsed.questions[7];
  assert.equal(q8.questionNumber, 8);
  assert.equal(q8.type, "long_answer");
  assert.ok(q8.modelAnswer?.includes("रोहन:"));
  assert.ok(q8.modelAnswer?.includes("सोहन:"));
  assert.ok(q8.modelAnswer?.includes("\n"));

  // Q9: Grammar
  const q9 = parsed.questions[8];
  assert.equal(q9.questionNumber, 9);
  assert.ok(q9.modelAnswer?.includes("संधि"));

  // Also verify parseAssessmentText parses all 9 questions
  const assessResult = parseAssessmentText(hindi9SectionPaper, mockContext);
  assert.equal(assessResult.success, true);
  assert.equal(assessResult.questions.length, 9);

  // Also verify parseUniversalTestText parses all 9 questions
  const uniResult = parseUniversalTestText(hindi9SectionPaper, mockContext);
  assert.equal(uniResult.success, true);
  assert.equal(uniResult.questions.length, 9);
});

