/**
 * deenUnread.js
 *
 * Aggregate unread count for the bottom-nav "Deen" tab badge — hadith +
 * questions, using the exact same read-tracking keys/logic DeenScreen
 * already uses for its own per-card badges ("read_hadiths" /
 * "read_questions", 48h hadith expiry window). Kept as a standalone util
 * so HomeScreen (always mounted, owns the bottom-nav badge props) can
 * compute the tab-level total without DeenScreen needing to be mounted.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiAxios, authApiAxios } from "../config/server";

const IMAM_ROLES = ["imam", "admin", "superadmin", "super_admin", "super admin"];

// Imam/admin need a fundamentally different signal than everyone else: the
// general "/questions" feed only returns already-answered questions, so it
// can never reflect what an imam actually needs to act on. For them the
// badge is the PENDING queue (awaiting their reply) — it naturally clears
// as they answer, no local "read" bookkeeping needed since answering IS
// the read action.
export const IMAM_LIKE_ROLES = IMAM_ROLES;

export async function getPendingQuestionCount() {
  try {
    const res = await authApiAxios({ method: "get", url: "/questions/pending" });
    return Array.isArray(res.data) ? res.data.length : 0;
  } catch (_) {
    return 0;
  }
}

async function getMemberUnreadCounts() {
  try {
    const [readHadiths, readQuestions] = await Promise.all([
      AsyncStorage.getItem("read_hadiths"),
      AsyncStorage.getItem("read_questions"),
    ]);
    const readHadithIds = readHadiths ? JSON.parse(readHadiths) : [];
    const readQuestionIds = readQuestions ? JSON.parse(readQuestions) : [];

    const [hadithRes, questionsRes] = await Promise.all(
      [
        apiAxios({ method: "get", url: "/hadith" }),
        apiAxios({ method: "get", url: "/questions" }),
      ].map((p) => p.catch(() => ({ data: [] })))
    );

    const hadiths = hadithRes.data || [];
    const questions = questionsRes.data || [];

    const now = new Date();
    const freshHadiths = hadiths.filter((h) => {
      if (!h.created_at) return true;
      const hoursDiff = (now - new Date(h.created_at)) / (1000 * 60 * 60);
      return hoursDiff < 48;
    });

    const unreadHadith = freshHadiths.filter((h) => !readHadithIds.includes(h.id)).length;
    const unreadQuestions = questions.filter((q) => !readQuestionIds.includes(q.id)).length;

    return unreadHadith + unreadQuestions;
  } catch (_) {
    return 0;
  }
}

export async function getDeenUnreadCount(role) {
  const normalizedRole = (role || "").toString().trim().toLowerCase();
  if (IMAM_ROLES.includes(normalizedRole)) {
    const [pendingQuestions, memberCounts] = await Promise.all([
      getPendingQuestionCount(),
      getMemberUnreadCounts(),
    ]);
    return pendingQuestions + memberCounts;
  }
  return getMemberUnreadCounts();
}
