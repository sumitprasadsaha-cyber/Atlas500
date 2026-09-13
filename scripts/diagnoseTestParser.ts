import { parseAssessmentText } from "../src/utils/assessmentParser";
import { resolveQuestionPassage } from "../src/utils/passageHelper";

const sampleInput = `
Class 10 — Social Science | Economics
Chapter: Money and Credit

Section A — Multiple Choice Questions
5 × 1 = 5 Marks

1. Which of the following is a modern form of money?
A. Gold coins
B. Paper currency
C. Silver coins
D. Grain
Answer: B

2. What is the main source of income for a bank?
A. Deposits of customers
B. Interest charged on loans minus interest paid on deposits
C. Government grants
D. Fees on locker facilities
Answer: B

3. Who issues currency notes in India?
A. State Bank of India
B. Reserve Bank of India
C. Ministry of Finance
D. NITI Aayog
Answer: B

4. An agreement in which the lender supplies the borrower with money, goods or services in return for the promise of future payment is called:
A. Credit
B. Collateral
C. Deposit
D. Investment
Answer: A

5. Which agency conducts periodic meetings to ensure banks maintain minimum cash reserves?
A. SEBI
B. RBI
C. Finance Commission
D. NABARD
Answer: B

Section B — Assertion and Reasoning
2 × 1 = 2 Marks

1. Assertion (A): Banks charge a higher interest rate on loans than what they offer on deposits.
Reason (R): The difference between what is charged from borrowers and what is paid to depositors is the main source of income for banks.
A. Both A and R are true and R is the correct explanation of A.
B. Both A and R are true but R is not the correct explanation of A.
C. A is true but R is false.
D. A is false but R is true.
Answer: A

2. Assertion (A): Informal sector credit comprises moneylenders, traders, and relatives.
Reason (R): There is an organization that supervises the credit activities of lenders in the informal sector.
A. Both A and R are true and R is the correct explanation of A.
B. Both A and R are true but R is not the correct explanation of A.
C. A is true but R is false.
D. A is false but R is true.
Answer: C

Section C — True and False
2 × 1 = 2 Marks

1. Collateral is an asset that the borrower owns and uses this as a guarantee to a lender until the loan is repaid.
Answer: True

2. Most loans from informal lenders carry a very low interest rate.
Answer: False

Section D — Very Short Answer Questions
5 × 2 = 10 Marks

1. What is meant by double coincidence of wants?
Answer: Double coincidence of wants means that what a person desires to sell is exactly what the other wishes to buy.

2. Define terms of credit.
Answer: Terms of credit comprise interest rate, collateral, documentation requirement, and the mode of repayment.

3. Why is modern currency accepted as a medium of exchange without any use of its own?
Answer: It is accepted as a medium of exchange because the currency is authorized by the government of India.

4. Mention one limitation of the barter system.
Answer: Lack of double coincidence of wants makes transactions difficult and costly.

5. What are demand deposits?
Answer: Deposits in the bank accounts which can be withdrawn on demand are called demand deposits.

Section E — Short Answer Questions
3 × 3 = 9 Marks

1. Explain the three main terms of credit that borrowers must fulfill before taking a loan.
Answer: Borrowers must agree to the interest rate, provide collateral security, submit identity/income documents, and agree to repayment terms.

2. Distinguish between formal and informal sources of credit in India.
Answer: Formal credit is supervised by RBI with lower interest rates; informal credit has no supervisor and charges exorbitant interest rates.

3. How do Self Help Groups (SHGs) help the rural poor, especially women?
Answer: SHGs pool small savings, provide loans at reasonable rates without collateral, and empower rural women socially and financially.

Section F — Long Answer Questions
2 × 5 = 10 Marks

1. Describe the vital and positive role of credit with the help of a suitable example.
Answer: Credit provides working capital for production. For example, a manufacturer uses credit to buy raw materials, pays workers, meets delivery on time, makes profit, and repays the loan.

2. Why is cheap and affordable credit crucial for the country's development? Explain five reasons.
Answer: Cheap credit enables farmers to invest in agriculture, allows entrepreneurs to set up industries, reduces reliance on informal moneylenders, prevents debt-traps, and generates employment and national income.

Section G — Case-Based Question
4 × 1 = 4 Marks

Read the following case carefully and answer the questions that follow:
Megha has taken a loan of Rs 5 lakhs from the bank to purchase a house. The annual interest rate on the loan is 12 per cent and the loan is to be repaid in 10 years in monthly instalments. The bank retained the papers of the new house as collateral, which will be returned to Megha only when she repays the entire loan with interest.

1. What is the collateral kept by the bank for Megha's loan?
Answer: The papers of the new house are kept as collateral by the bank.

2. In how many years is Megha supposed to repay the loan?
Answer: Megha is supposed to repay the loan in 10 years in monthly installments.

3. What rate of interest is Megha paying on the home loan?
Answer: Megha is paying an annual interest rate of 12 percent.

4. Which category of credit source (formal or informal) does Megha's loan belong to?
Answer: Megha's loan belongs to the formal source of credit because it is provided by a commercial bank.
`;

const res = parseAssessmentText(sampleInput, {
  classGrade: "Class 10",
  subject: "Social Science",
  chapterNo: 3,
  chapterName: "Money and Credit",
  topicName: "Money and Credit Full Test"
});

console.log("--- UI SIMULATION ---");
const testContext = { passages: res.passages, cases: res.cases };

res.questions.forEach((q, idx) => {
  const qPassage = resolveQuestionPassage(q, testContext);
  const prevQ = idx > 0 ? res.questions[idx - 1] : null;
  const prevPassage = prevQ ? resolveQuestionPassage(prevQ, testContext) : null;
  const isPassageStart = qPassage && (!prevPassage || prevPassage.id !== qPassage.id || prevPassage.text !== qPassage.text);
  
  const subQuestionLabel = q.groupTitle || (qPassage ? (qPassage.isCaseStudy ? "Case Study Sub-Question" : "Comprehension Sub-Question") : null);

  console.log(`Q${idx + 1} (display: ${q.displayNumber || "Q" + (idx + 1)}): ` +
    `isPassageStart=${isPassageStart} ` +
    `hasPassage=${!!qPassage} ` +
    `label="${subQuestionLabel}" ` +
    `marks="${q.marks} Marks (${(q.marksSource || "").replace("_", " ")})"`);
});
