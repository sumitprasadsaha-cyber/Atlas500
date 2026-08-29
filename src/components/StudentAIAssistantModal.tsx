import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Send,
  Bot,
  User,
  X,
  RefreshCw,
  Copy,
  Check,
  BookOpen,
  HelpCircle,
  Lightbulb,
  GraduationCap,
  Layers,
  Flame,
  AlertCircle
} from "lucide-react";
import { Student } from "../types";
import { askStudentAIChat, getAIUserLimits } from "../lib/aiService";

interface StudentAIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student;
  activeSubject?: string | null;
  activeChapterName?: string | null;
  activeTopicName?: string | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  time: string;
}

const QUICK_SUGGESTIONS = [
  "Explain this concept with simple real-life examples",
  "Give me 3 quick practice questions to test my understanding",
  "Summarize key formulas & definitions for quick revision",
  "Step-by-step exam preparation strategy",
];

export default function StudentAIAssistantModal({
  isOpen,
  onClose,
  student,
  activeSubject,
  activeChapterName,
  activeTopicName,
}: StudentAIAssistantModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [dailyQuotaRemaining, setDailyQuotaRemaining] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastFailedQuery, setLastFailedQuery] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize welcome message
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const subjectContext = activeSubject ? ` in **${activeSubject}**` : "";
      const topicContext = activeTopicName ? ` (Topic: *${activeTopicName}*)` : activeChapterName ? ` (*${activeChapterName}*)` : "";
      
      setMessages([
        {
          id: "welcome-student",
          role: "model",
          text: `Hi **${student.name.split(" ")[0]}**! 👋 I'm your **Atlas AI Study Tutor**.\n\nI can explain concepts${subjectContext}${topicContext}, help with homework, solve math & science doubts step-by-step, or quiz you before tests! What would you like to learn today?`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    }
  }, [isOpen, activeSubject, activeChapterName, activeTopicName, student.name]);

  // Load quota status
  useEffect(() => {
    if (isOpen) {
      getAIUserLimits(student.id, "student")
        .then((quota) => setDailyQuotaRemaining(quota.dailyRemaining))
        .catch(() => {});
    }
  }, [isOpen, student.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  if (!isOpen) return null;

  const handleSendMessage = async (queryText?: string) => {
    const textToSend = (queryText || inputQuery).trim();
    if (!textToSend || loading) return;

    setErrorMsg(null);
    setInputQuery("");

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: textToSend,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const contextNotes = activeSubject
        ? `Subject: ${activeSubject}\nChapter: ${activeChapterName || "General"}\nTopic: ${activeTopicName || "General"}`
        : undefined;

      const historyPayload = messages
        .filter((m) => m.id !== "welcome-student")
        .map((m) => ({ role: m.role, text: m.text }));

      const response = await askStudentAIChat({
        query: textToSend,
        studentId: student.id,
        studentName: student.name,
        classGrade: student.classGrade,
        enrolledSubjects: student.enrolledSubjects || [],
        notesContext: contextNotes,
        recentTestTopic: activeTopicName || activeChapterName || undefined,
        history: historyPayload,
      });

      const aiMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: "model",
        text: response.reply,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, aiMessage]);
      setLastFailedQuery(null);
      if (typeof response.remainingDailyQuota === "number") {
        setDailyQuotaRemaining(response.remainingDailyQuota);
      }
    } catch (err: any) {
      console.error("Student AI error:", err);
      setErrorMsg(err.message || "Failed to reach AI Tutor. Please try again.");
      setLastFailedQuery(textToSend);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: "model",
        text: `Fresh chat started! Ask me any academic question, doubt, or revision query.`,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4 backdrop-blur-xs">
      <div
        id="student-ai-tutor-modal"
        className="relative flex h-[90vh] max-h-[780px] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-4 py-3.5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 shadow-inner">
              <Sparkles className="h-5 w-5 text-amber-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black tracking-tight text-white">Atlas AI Study Tutor</h3>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-100">
                  {student.classGrade || "Tuition Space"}
                </span>
              </div>
              <p className="text-xs text-blue-100/90">
                {activeSubject ? `Grounded in ${activeSubject}` : "Your 24/7 Personal Academic Coach"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {dailyQuotaRemaining !== null && (
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white">
                <Flame className="h-3.5 w-3.5 text-amber-300" />
                {dailyQuotaRemaining} queries left today
              </span>
            )}
            <button
              onClick={handleClearChat}
              title="Clear Conversation"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Active Context Banner if Subject / Topic is selected */}
        {(activeSubject || activeTopicName) && (
          <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50/80 px-4 py-2 text-xs text-blue-900">
            <div className="flex items-center gap-1.5 truncate">
              <BookOpen className="h-3.5 w-3.5 text-blue-600 shrink-0" />
              <span className="font-bold">Subject:</span>
              <span className="truncate">{activeSubject || "All Subjects"}</span>
              {activeTopicName && (
                <>
                  <span className="text-blue-400">•</span>
                  <span className="font-bold">Topic:</span>
                  <span className="truncate text-blue-700">{activeTopicName}</span>
                </>
              )}
            </div>
            <span className="text-[10px] font-semibold uppercase text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full shrink-0">
              Active Context
            </span>
          </div>
        )}

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/60">
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
              >
                {/* Avatar */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isUser
                      ? "bg-blue-600 text-white"
                      : "bg-gradient-to-tr from-violet-600 to-indigo-600 text-white shadow-xs"
                  }`}
                >
                  {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                </div>

                {/* Message Bubble */}
                <div className={`flex flex-col max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
                  <div
                    className={`relative rounded-[18px] px-4 py-3 text-sm shadow-xs ${
                      isUser
                        ? "bg-blue-600 text-white rounded-tr-xs"
                        : "bg-white text-slate-800 border border-slate-200/80 rounded-tl-xs"
                    }`}
                  >
                    <div className="prose prose-sm max-w-none break-words whitespace-pre-wrap leading-relaxed">
                      {msg.text}
                    </div>

                    {!isUser && (
                      <div className="mt-2 flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-400">
                        <span>{msg.time}</span>
                        <button
                          onClick={() => handleCopyMessage(msg.id, msg.text)}
                          className="flex items-center gap-1 text-slate-500 hover:text-slate-800 transition"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" />
                              <span className="text-emerald-600 font-semibold">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  {isUser && <span className="mt-1 text-[10px] text-slate-400 pr-1">{msg.time}</span>}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-violet-600 to-indigo-600 text-white shadow-xs">
                <Bot className="h-4 w-4 animate-spin" />
              </div>
              <div className="rounded-[18px] rounded-tl-xs border border-slate-200 bg-white px-4 py-3 shadow-xs">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                  <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                  Atlas AI Tutor is formulating an explanation...
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                <span>{errorMsg}</span>
              </div>
              {lastFailedQuery && (
                <button
                  onClick={() => handleSendMessage(lastFailedQuery)}
                  disabled={loading}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-red-100 text-red-800 hover:bg-red-200 rounded-lg transition disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        {messages.length < 5 && !loading && (
          <div className="border-t border-slate-100 bg-white px-4 py-2 flex gap-2 overflow-x-auto no-scrollbar">
            {QUICK_SUGGESTIONS.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(chip)}
                className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition active:scale-95"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Input Bar */}
        <div className="border-t border-slate-200 bg-white p-3 sm:p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder={`Ask doubt in ${activeSubject || "any subject"}, homework help, math steps...`}
              disabled={loading}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100"
            />
            <button
              type="submit"
              disabled={!inputQuery.trim() || loading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
