/**
 * HomeScreen.js — Mohideen Masjid
 *
 * Fixes in this pass:
 *  - Prayer names were blank: PRAYER_META previously ran t() once at
 *    module-load time and froze the result into a constant. Rebuilt as
 *    a function called fresh on every render (getPrayerMeta()) so the
 *    labels are always populated - and so a future locale switch will
 *    actually retranslate them instead of staying stuck in whatever
 *    language was active when the app first loaded.
 *  - Checkmarks were showing "completed" just because a prayer's time
 *    had passed, even if you never tapped to confirm it. Time passing
 *    isn't the same as having prayed - the dot now ONLY fills when you
 *    manually tap it. Time-passed-but-unconfirmed rows are shown dimmed
 *    instead, which is an honest signal rather than a false claim.
 *  - No offline handling before: a failed fetch just showed a red error
 *    banner and nothing else. Now timings cache to AsyncStorage on every
 *    successful fetch and are loaded from cache immediately on open,
 *    before the network call resolves - if the server's down you keep
 *    seeing the last known times with a small "Offline" pill instead of
 *    losing the screen.
 *  - Removed Quick Actions entirely, per request.
 *  - Removed the ScrollView - header is fixed height, Upcoming Prayer
 *    card is fixed height, and the prayer rows split the remaining
 *    space equally via flex, so the screen always fits without
 *    scrolling regardless of device height.
 */

import React, { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, Text, StyleSheet, ActivityIndicator, StatusBar, Animated, Platform, Dimensions, Vibration, PermissionsAndroid, Alert, NativeModules, InteractionManager } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import messaging, {
  getToken as getFcmToken,
  subscribeToTopic,
  onMessage,
  onTokenRefresh,
  onNotificationOpenedApp,
} from "@react-native-firebase/messaging";
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiAxios, authApiAxios, getWsUrl } from "../config/server";
import { getToken, deleteToken, deleteRefreshToken } from "../utils/secureStorage";
import { registerFcmToken, subscribeRoleTopics } from "../utils/fcmRegistration";
import PrayerNotificationService from "../services/PrayerNotificationService";
import { handlePrayerFcmMessage } from "../utils/prayerFcm";
import { syncPrayerTimesToLocalScheduler } from "../utils/prayerScheduleSync";
import { showGenericPush } from "../utils/genericPush";
import { getDeenUnreadCount } from "../utils/deenUnread";
import { COLORS as C } from "../config/theme";
import { useTranslation } from "react-i18next";
import BottomNav from "../components/BottomNav";
import { useBottomNavHeight } from "../hooks/useSafeArea";
import { logger } from "../utils/logger";
import FivePrayerCelebration from "../components/FivePrayerCelebration";
import {
  localDayKey, trackerKeyFor, celebrationKeyFor,
} from "../utils/prayerDay";

const { width: SW } = Dimensions.get("window");
const PRAYER_CACHE_KEY = "cached_prayer_timings";
const ANNOUNCEMENTS_CACHE_KEY = "cached_announcements";
const EXACT_ALARM_PROMPT_KEY = "exact_alarm_prompt_shown";
const IOS = Platform.OS === "ios";

// Android 13+ only grants SCHEDULE_EXACT_ALARM via a manual Settings toggle —
// there's no runtime permission dialog for it. Without it, the offline
// Iqamah/Adhan alarm schedule (PrayerNotificationService) silently degrades
// to an inexact alarm that Doze can defer well past the actual prayer time,
// so we ask once, on first Home mount, with a direct link to the toggle.
async function ensureExactAlarmPermission() {
  if (Platform.OS !== "android" || !NativeModules.IqamahScheduler?.canScheduleExactAlarms) return;
  try {
    const alreadyShown = await AsyncStorage.getItem(EXACT_ALARM_PROMPT_KEY);
    if (alreadyShown) return;

    const canSchedule = await NativeModules.IqamahScheduler.canScheduleExactAlarms();
    if (canSchedule) {
      await AsyncStorage.setItem(EXACT_ALARM_PROMPT_KEY, "1");
      return;
    }

    Alert.alert(
      "Enable Reliable Prayer Alerts",
      "To make sure Adhan and Iqamah notifications fire exactly on time — even with no internet — please allow this app to schedule exact alarms.",
      [
        { text: "Not Now", style: "cancel", onPress: () => AsyncStorage.setItem(EXACT_ALARM_PROMPT_KEY, "1") },
        {
          text: "Enable",
          onPress: () => {
            AsyncStorage.setItem(EXACT_ALARM_PROMPT_KEY, "1");
            NativeModules.IqamahScheduler.requestExactAlarmPermission();
          },
        },
      ],
    );
  } catch (_) {}
}

const H = {
  bg: "#FBF9F4",
  card: "#FFFFFF",
  cardBorder: "rgba(11,61,46,0.08)",
  headerDeep: C.bg,
  headerLight: C.bgVivid,
  gold: C.gold,
  goldLight: C.goldLight,
  goldDeep: C.goldDeep,
  textDark: C.textDark,
  textMuted: C.textMuted,
  white: C.white,
  error: "#C0473A",
  fajr: "#E8C97A",
  dhuhr: C.gold,
  jummah: "#B8863A",
  asr: "#B8963A",
  maghrib: "#D4B15C",
  isha: "#8E6A24",
  missed: "#9AA39C",
};

const shadow = (y = 4, opacity = 0.08) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: y * 1.6 },
    android: { elevation: y },
  });

// ─── Hijri date (tabular/civil calendar approximation) ───────────────────
const HIJRI_MONTHS = [
  "Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Thani", "Jumada al-Awwal", "Jumada al-Thani",
  "Rajab", "Sha'ban", "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah",
];

const gregorianToJDN = (y, m, d) => {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
};

const jdnToHijri = (jdn) => {
  const epoch = 1948440;
  let l = jdn - epoch + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const month = Math.floor((24 * l) / 709);
  const day = l - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;
  return { year, month, day };
};

const getHijriDateString = (date) => {
  try {
    const jdn = gregorianToJDN(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const { year, month, day } = jdnToHijri(jdn);
    const monthName = HIJRI_MONTHS[Math.max(0, Math.min(11, month - 1))];
    return `${day} ${monthName} ${year} AH`;
  } catch {
    return "—";
  }
};

const getGreetingKey = (hour) => {
  if (hour < 12) return "greeting.morning";
  if (hour < 17) return "greeting.afternoon";
  return "greeting.evening";
};

// Rebuilt fresh every call (not frozen at module load) - this is the
// fix for the blank prayer-name bug, and it's also what makes a future
// locale switch actually retranslate these labels.
const getPrayerMeta = (t) => ({
  fajr: { key: "fajr", label: t("prayers.fajr"), arabic: t("prayers.fajrArabic"), color: H.fajr },
  dhuhr: { key: "dhuhr", label: t("prayers.dhuhr"), arabic: t("prayers.dhuhrArabic"), color: H.dhuhr },
  jummah: { key: "jummah", label: t("prayers.jummah"), arabic: t("prayers.jummahArabic"), color: H.jummah },
  asr: { key: "asr", label: t("prayers.asr"), arabic: t("prayers.asrArabic"), color: H.asr },
  maghrib: { key: "maghrib", label: t("prayers.maghrib"), arabic: t("prayers.maghribArabic"), color: H.maghrib },
  isha: { key: "isha", label: t("prayers.isha"), arabic: t("prayers.ishaArabic"), color: H.isha },
});

// ─── Utility functions ────────────────────────────────────────────────
const getAdhanTime = (timings, prayer) => timings?.adhan?.[prayer];
const getIqamahTime = (timings, prayer) => timings?.prayer?.[prayer];
const pad = (n) => String(n).padStart(2, "0");

const timeToMinutes = (timeStr, prayerName) => {
  if (!timeStr) return null;
  let [time, modifier] = String(timeStr).trim().split(/\s+/);
  if (!time) return null;
  let [hours, minutes] = time.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;
  if (!modifier && prayerName) {
    const p = prayerName.toLowerCase();
    if (["asr", "maghrib", "isha", "taraweeh"].includes(p)) modifier = "PM";
    else if (["fajr", "imsak", "dhuha", "ishraq"].includes(p)) modifier = "AM";
    else if (["dhuhr", "jummah"].includes(p)) modifier = (hours >= 1 && hours <= 5) || hours === 12 ? "PM" : "AM";
  }
  if (modifier) {
    modifier = modifier.toLowerCase();
    if (modifier === "pm" && hours < 12) hours += 12;
    if (modifier === "am" && hours === 12) hours = 0;
  }
  return hours * 60 + minutes;
};

const parseTimeStr = (timeStr, prayerName) => {
  if (!timeStr) return "—";
  let [time, modifier] = String(timeStr).trim().split(/\s+/);
  if (!time) return "—";
  let [hours, minutes] = time.split(":");
  if (hours === undefined || minutes === undefined) return timeStr;
  let h = parseInt(hours, 10);
  if (isNaN(h)) return timeStr;
  if (!modifier && prayerName) {
    const p = prayerName.toLowerCase();
    if (["asr", "maghrib", "isha", "taraweeh"].includes(p)) modifier = "PM";
    else if (["fajr", "imsak", "dhuha", "ishraq"].includes(p)) modifier = "AM";
    else if (["dhuhr", "jummah"].includes(p)) modifier = (h >= 1 && h <= 5) || h === 12 ? "PM" : "AM";
  }
  if (modifier) {
    modifier = modifier.toLowerCase();
    if (modifier === "pm" && h < 12) h += 12;
    if (modifier === "am" && h === 12) h = 0;
  }
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${minutes} ${ampm}`;
};

const getCurrentMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

const isFriday = () => new Date().getDay() === 5;

const parseJsonArray = (value) => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const computeUnreadAnnouncements = (announcements, seenIds) =>
  announcements.filter((a) => !seenIds.includes(a.id)).length;

// Friday Dhuhr -> Jumu'ah swap, centralized so nothing shows both.
const buildPrayerList = (timings, friday, t) => {
  const META = getPrayerMeta(t);
  const list = [];
  list.push({ ...META.fajr, adhan: getAdhanTime(timings, "fajr"), iqamah: getIqamahTime(timings, "fajr") });
  if (friday) {
    list.push({ ...META.jummah, adhan: timings?.prayer?.jummah, iqamah: timings?.prayer?.jummah_iqamah });
  } else {
    list.push({ ...META.dhuhr, adhan: getAdhanTime(timings, "dhuhr"), iqamah: getIqamahTime(timings, "dhuhr") });
  }
  list.push({ ...META.asr, adhan: getAdhanTime(timings, "asr"), iqamah: getIqamahTime(timings, "asr") });
  list.push({ ...META.maghrib, adhan: getAdhanTime(timings, "maghrib"), iqamah: getIqamahTime(timings, "maghrib") });
  list.push({ ...META.isha, adhan: getAdhanTime(timings, "isha"), iqamah: getIqamahTime(timings, "isha") });
  return list;
};

const primaryTime = (item) => item?.iqamah || item?.adhan;
const primaryKeyFor = (item) => item?.key;

const getNextIndex = (list) => {
  const now = getCurrentMinutes();
  for (let i = 0; i < list.length; i++) {
    const mins = timeToMinutes(primaryTime(list[i]), primaryKeyFor(list[i]));
    if (mins !== null && mins > now) return i;
  }
  return 0;
};

const getTimeUntil = (list, index) => {
  const item = list[index];
  const target = timeToMinutes(primaryTime(item), primaryKeyFor(item));
  if (target === null) return null;
  const now = getCurrentMinutes();
  let diff = target - now;
  if (diff <= 0) diff += 24 * 60;
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const getWindowProgress = (list, nextIndex) => {
  const now = getCurrentMinutes();
  const nextMins = timeToMinutes(primaryTime(list[nextIndex]), primaryKeyFor(list[nextIndex]));
  const prevIndex = (nextIndex - 1 + list.length) % list.length;
  let prevMins = timeToMinutes(primaryTime(list[prevIndex]), primaryKeyFor(list[prevIndex]));
  if (nextMins === null) return 0;
  let nowAdj = now;
  let nextAdj = nextMins;
  if (prevMins === null) prevMins = nextMins - 60;
  if (nextAdj <= prevMins) nextAdj += 24 * 60;
  if (nowAdj < prevMins) nowAdj += 24 * 60;
  const total = nextAdj - prevMins;
  const elapsed = nowAdj - prevMins;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, elapsed / total));
};

const QURAN_VERSES = [
  { text: "Indeed, with hardship will be ease.", ref: "Qur'an 94:6" },
  { text: "So remember Me; I will remember you.", ref: "Qur'an 2:152" },
  { text: "And He found you lost and guided you.", ref: "Qur'an 93:7" },
  { text: "Call upon Me; I will respond to you.", ref: "Qur'an 40:60" },
  { text: "Allah does not burden a soul beyond its capacity.", ref: "Qur'an 2:286" },
  { text: "And He is with you wherever you are.", ref: "Qur'an 57:4" },
  { text: "So be patient. Indeed, the promise of Allah is truth.", ref: "Qur'an 30:60" },
  { text: "Indeed, Allah is with the patient.", ref: "Qur'an 2:153" },
  { text: "And put your trust in Allah.", ref: "Qur'an 33:3" },
  { text: "Sufficient for us is Allah, and He is the best Disposer of affairs.", ref: "Qur'an 3:173" },
  { text: "And do not lose hope in the mercy of Allah.", ref: "Qur'an 39:53" },
  { text: "Indeed, the mercy of Allah is near to the doers of good.", ref: "Qur'an 7:56" },
  { text: "And whoever fears Allah – He will make a way out.", ref: "Qur'an 65:2" },
  { text: "And He will provide for him from sources he could never imagine.", ref: "Qur'an 65:3" },
  { text: "Unquestionably, the help of Allah is near.", ref: "Qur'an 2:214" },
  { text: "And say, 'My Lord, increase me in knowledge.'", ref: "Qur'an 20:114" },
  { text: "And speak to people good words.", ref: "Qur'an 2:83" },
  { text: "And be good to parents.", ref: "Qur'an 4:36" },
  { text: "And lower to them the wing of humility out of mercy.", ref: "Qur'an 17:24" },
  { text: "And do good; indeed, Allah loves the doers of good.", ref: "Qur'an 2:195" },
  { text: "Indeed, Allah orders justice and good conduct.", ref: "Qur'an 16:90" },
  { text: "Help one another in righteousness and piety.", ref: "Qur'an 5:2" },
  { text: "And do not cooperate in sin and aggression.", ref: "Qur'an 5:2" },
  { text: "And fulfill [every] commitment. Indeed, the commitment is ever questioned.", ref: "Qur'an 17:34" },
  { text: "And do not mix truth with falsehood.", ref: "Qur'an 2:42" },
  { text: "Be just; that is nearer to righteousness.", ref: "Qur'an 5:8" },
  { text: "And do not walk on the earth exultantly.", ref: "Qur'an 17:37" },
  { text: "And be moderate in your pace and lower your voice.", ref: "Qur'an 31:19" },
  { text: "Indeed, Allah does not like the arrogant.", ref: "Qur'an 16:23" },
  { text: "The believers are but brothers, so make peace between your brothers.", ref: "Qur'an 49:10" },
  { text: "And do not spy or backbite one another.", ref: "Qur'an 49:12" },
  { text: "Avoid much suspicion; indeed, some suspicion is sin.", ref: "Qur'an 49:12" },
  { text: "Worship Allah and associate nothing with Him.", ref: "Qur'an 4:36" },
  { text: "And establish prayer and give zakah.", ref: "Qur'an 2:43" },
  { text: "And enjoin prayer upon your family and be steadfast therein.", ref: "Qur'an 20:132" },
  { text: "Recite what has been revealed to you of the Book.", ref: "Qur'an 29:45" },
  { text: "And when the Qur'an is recited, listen to it attentively.", ref: "Qur'an 7:204" },
  { text: "Then do they not reflect upon the Qur'an?", ref: "Qur'an 4:82" },
  { text: "And We have certainly made the Qur'an easy for remembrance.", ref: "Qur'an 54:17" },
  { text: "The month of Ramadan is that in which the Qur'an was revealed.", ref: "Qur'an 2:185" },
  { text: "The Night of Decree is better than a thousand months.", ref: "Qur'an 97:3" },
  { text: "Peace it is until the emergence of dawn.", ref: "Qur'an 97:5" },
  { text: "By the dawn, and [by] the ten nights.", ref: "Qur'an 89:1-2" },
  { text: "By the morning brightness, and the night when it covers.", ref: "Qur'an 93:1-2" },
  { text: "By the sun and its brightness, and the moon following it.", ref: "Qur'an 91:1-2" },
  { text: "By the night when it covers, and the day when it appears.", ref: "Qur'an 92:1-2" },
  { text: "By time, indeed mankind is in loss.", ref: "Qur'an 103:1-2" },
  { text: "Except for those who believe and do righteous deeds.", ref: "Qur'an 103:3" },
  { text: "So whoever does an atom's weight of good will see it.", ref: "Qur'an 99:7" },
  { text: "And whoever does an atom's weight of evil will see it.", ref: "Qur'an 99:8" },
  { text: "When the earth is shaken with its final earthquake.", ref: "Qur'an 99:1" },
  { text: "And the earth will discharge its burdens.", ref: "Qur'an 99:2" },
  { text: "When the sky splits open, and listens to its Lord.", ref: "Qur'an 84:1-2" },
  { text: "O mankind, you are laboring toward your Lord and will meet Him.", ref: "Qur'an 84:6" },
  { text: "Then as for he who is given his record in his right hand.", ref: "Qur'an 84:7" },
  { text: "He will be judged with an easy account and return happy.", ref: "Qur'an 84:7-9" },
  { text: "But as for he who is given his record behind his back.", ref: "Qur'an 84:10" },
  { text: "He will cry out for destruction and enter a Blaze.", ref: "Qur'an 84:11-12" },
  { text: "No! You prefer the worldly life, but the Hereafter is better.", ref: "Qur'an 87:16-17" },
  { text: "He has succeeded who purifies himself.", ref: "Qur'an 87:14" },
  { text: "And mentions the name of his Lord and prays.", ref: "Qur'an 87:15" },
  { text: "And the Hereafter is better and more enduring.", ref: "Qur'an 87:17" },
  { text: "We will ease you toward ease.", ref: "Qur'an 87:8" },
  { text: "So remind, if the reminder should benefit.", ref: "Qur'an 87:9" },
  { text: "He who fears [Allah] will be reminded.", ref: "Qur'an 87:10" },
  { text: "But the wretched one will avoid it.", ref: "Qur'an 87:11" },
  { text: "They will burn in the greatest Fire, neither dying nor living.", ref: "Qur'an 87:12-13" },
  { text: "O reassured soul, return to your Lord well-pleased.", ref: "Qur'an 89:27-28" },
  { text: "Enter among My servants and enter My Paradise.", ref: "Qur'an 89:29-30" },
  { text: "By the sky and the night comer – the piercing star.", ref: "Qur'an 86:1-3" },
  { text: "There is no soul without a protector over it.", ref: "Qur'an 86:4" },
  { text: "Man was created from a fluid, ejected.", ref: "Qur'an 86:6" },
  { text: "Indeed, He is able to return him to life.", ref: "Qur'an 86:8" },
  { text: "On the Day when secrets will be tried.", ref: "Qur'an 86:9" },
  { text: "Then man will have no power nor any helper.", ref: "Qur'an 86:10" },
  { text: "By the sky which returns rain and the earth cracking open.", ref: "Qur'an 86:11-12" },
  { text: "Indeed, the Qur'an is a decisive statement, not amusement.", ref: "Qur'an 86:13-14" },
  { text: "So allow time for the disbelievers; leave them awhile.", ref: "Qur'an 86:17" },
  { text: "Woe to every scorner and mocker.", ref: "Qur'an 104:1" },
  { text: "He thinks his wealth will make him immortal.", ref: "Qur'an 104:3" },
  { text: "No! He will surely be thrown into the Crusher.", ref: "Qur'an 104:4" },
  { text: "It is the fire of Allah, eternally fueled.", ref: "Qur'an 104:6" },
  { text: "Which mounts directed at the hearts.", ref: "Qur'an 104:7" },
  { text: "Have you not considered how your Lord dealt with the elephant?", ref: "Qur'an 105:1" },
  { text: "Did He not make their plan go astray?", ref: "Qur'an 105:2" },
  { text: "And He sent against them birds in flocks.", ref: "Qur'an 105:3" },
  { text: "Striking them with stones of baked clay.", ref: "Qur'an 105:4" },
  { text: "And He made them like eaten straw.", ref: "Qur'an 105:5" },
  { text: "For the protection of the Quraysh – their winter and summer journeys.", ref: "Qur'an 106:1-2" },
  { text: "Let them worship the Lord of this House, who fed them from hunger.", ref: "Qur'an 106:3-4" },
  { text: "And made them safe from fear.", ref: "Qur'an 106:4" },
  { text: "Have you seen the one who denies the Recompense?", ref: "Qur'an 107:1" },
  { text: "That is he who drives away the orphan.", ref: "Qur'an 107:2" },
  { text: "And does not encourage the feeding of the poor.", ref: "Qur'an 107:3" },
  { text: "So woe to those who pray, but are heedless of their prayer.", ref: "Qur'an 107:4-5" },
  { text: "Those who make show and withhold simple assistance.", ref: "Qur'an 107:6-7" },
  { text: "Indeed, We have granted you al-Kawthar.", ref: "Qur'an 108:1" },
  { text: "So pray to your Lord and sacrifice.", ref: "Qur'an 108:2" },
  { text: "Indeed, your enemy is the one cut off.", ref: "Qur'an 108:3" },
  { text: "Say, 'O disbelievers, I do not worship what you worship.'", ref: "Qur'an 109:1-2" },
  { text: "For you is your religion, and for me is my religion.", ref: "Qur'an 109:6" },
  { text: "When the victory of Allah has come and the conquest.", ref: "Qur'an 110:1" },
  { text: "And you see people entering the religion of Allah in multitudes.", ref: "Qur'an 110:2" },
  { text: "Then glorify with praise of your Lord and ask His forgiveness.", ref: "Qur'an 110:3" },
  { text: "May the hands of Abu Lahab be ruined, and ruined is he.", ref: "Qur'an 111:1" },
  { text: "His wealth and gains will not avail him.", ref: "Qur'an 111:2" },
  { text: "He will burn in a Fire of blazing flame.", ref: "Qur'an 111:3" },
  { text: "And his wife, the carrier of firewood.", ref: "Qur'an 111:4" },
  { text: "Around her neck is a rope of twisted fiber.", ref: "Qur'an 111:5" },
  { text: "Say, 'He is Allah, [who is] One.'", ref: "Qur'an 112:1" },
  { text: "Allah, the Eternal Refuge.", ref: "Qur'an 112:2" },
  { text: "He neither begets nor is born.", ref: "Qur'an 112:3" },
  { text: "Nor is there to Him any equivalent.", ref: "Qur'an 112:4" },
  { text: "Say, 'I seek refuge in the Lord of daybreak.'", ref: "Qur'an 113:1" },
  { text: "From the evil of that which He created.", ref: "Qur'an 113:2" },
  { text: "And from the evil of darkness when it settles.", ref: "Qur'an 113:3" },
  { text: "And from the evil of the blowers in knots.", ref: "Qur'an 113:4" },
  { text: "And from the evil of an envier when he envies.", ref: "Qur'an 113:5" },
  { text: "Say, 'I seek refuge in the Lord of mankind.'", ref: "Qur'an 114:1" },
  { text: "The Sovereign of mankind, the God of mankind.", ref: "Qur'an 114:2-3" },
  { text: "From the evil of the retreating whisperer.", ref: "Qur'an 114:4" },
  { text: "Who whispers into the breasts of mankind.", ref: "Qur'an 114:5" },
  { text: "From among the jinn and mankind.", ref: "Qur'an 114:6" },
  { text: "He created the heavens and the earth in truth.", ref: "Qur'an 39:5" },
  { text: "He wraps the night over the day and the day over the night.", ref: "Qur'an 39:5" },
  { text: "And He subjected the sun and the moon, each running for a term.", ref: "Qur'an 39:5" },
  { text: "And He created you from a single soul.", ref: "Qur'an 4:1" },
  { text: "And from it created its mate.", ref: "Qur'an 4:1" },
  { text: "And from them both spread many men and women.", ref: "Qur'an 4:1" },
  { text: "Fear Allah, through whom you ask one another.", ref: "Qur'an 4:1" },
  { text: "And fear the wombs that bore you; indeed, Allah is ever watching.", ref: "Qur'an 4:1" },
  { text: "And give orphans their property, and do not substitute the bad for the good.", ref: "Qur'an 4:2" },
  { text: "And do not consume their property into your own; that is a great sin.", ref: "Qur'an 4:2" },
  { text: "And if you fear you cannot deal justly with orphans, then marry two, three, or four.", ref: "Qur'an 4:3" },
  { text: "But if you fear you cannot be just, then [marry] only one.", ref: "Qur'an 4:3" },
  { text: "And give women their bridal gifts graciously.", ref: "Qur'an 4:4" },
  { text: "But if they remit any of it willingly, enjoy it with pleasure.", ref: "Qur'an 4:4" },
  { text: "And do not give the foolish your wealth, which Allah made a means of support.", ref: "Qur'an 4:5" },
  { text: "Test orphans until they reach marriageable age.", ref: "Qur'an 4:6" },
  { text: "Then if you perceive sound judgment, release their property to them.", ref: "Qur'an 4:6" },
  { text: "And do not consume it extravagantly and hastily, fearing they will grow up.", ref: "Qur'an 4:6" },
  { text: "Whoever is wealthy should abstain; whoever is poor may eat in fairness.", ref: "Qur'an 4:6" },
  { text: "And when you release their property, bring witnesses; Allah is sufficient as Accountant.", ref: "Qur'an 4:6" },
  { text: "For men is a share of what parents and relatives leave.", ref: "Qur'an 4:7" },
  { text: "And for women is a share of what parents and relatives leave.", ref: "Qur'an 4:7" },
  { text: "Whether it be little or much – an obligatory share.", ref: "Qur'an 4:7" },
  { text: "And when near relatives and orphans and the needy attend the division, then provide for them.", ref: "Qur'an 4:8" },
  { text: "And speak to them words of kindness.", ref: "Qur'an 4:8" },
  { text: "Let those who would fear for their own children fear and be just.", ref: "Qur'an 4:9" },
  { text: "Indeed, those who consume orphans' property unjustly only consume fire.", ref: "Qur'an 4:10" },
  { text: "Allah instructs you concerning your children: for a male, the share of two females.", ref: "Qur'an 4:11" },
  { text: "If there are only daughters, two or more, they share two-thirds.", ref: "Qur'an 4:11" },
  { text: "And if only one, she gets half.", ref: "Qur'an 4:11" },
  { text: "These shares are after any bequest made or debt paid.", ref: "Qur'an 4:11" },
  { text: "You do not know which of your parents or children is nearest in benefit.", ref: "Qur'an 4:11" },
  { text: "This is an obligation from Allah; indeed, Allah is Knowing and Wise.", ref: "Qur'an 4:11" },
  { text: "For you is half of what your wives leave, if they have no child.", ref: "Qur'an 4:12" },
  { text: "If they have a child, you get a quarter of what they leave.", ref: "Qur'an 4:12" },
  { text: "And for wives is a quarter of what you leave, if you have no child.", ref: "Qur'an 4:12" },
  { text: "If you have a child, they get an eighth of what you leave.", ref: "Qur'an 4:12" },
  { text: "These are limits set by Allah, and whoever obeys Allah and His Messenger.", ref: "Qur'an 4:13" },
  { text: "He will admit him to gardens beneath which rivers flow, abiding eternally.", ref: "Qur'an 4:13" },
  { text: "And that is the great attainment.", ref: "Qur'an 4:13" },
  { text: "And whoever disobeys Allah and His Messenger and transgresses His limits.", ref: "Qur'an 4:14" },
  { text: "He will admit him to a Fire, abiding eternally therein; and for him is a humiliating punishment.", ref: "Qur'an 4:14" },
  { text: "Those who commit immorality from your women, bring four witnesses among you.", ref: "Qur'an 4:15" },
  { text: "If they testify, confine them to houses until death takes them.", ref: "Qur'an 4:15" },
  { text: "Or Allah makes a way for them.", ref: "Qur'an 4:15" },
  { text: "And the two who commit it among you, punish them both.", ref: "Qur'an 4:16" },
  { text: "But if they repent and correct themselves, then leave them alone.", ref: "Qur'an 4:16" },
  { text: "Allah is ever Accepting of repentance and Merciful.", ref: "Qur'an 4:16" },
  { text: "Repentance accepted by Allah is only for those who do wrong in ignorance.", ref: "Qur'an 4:17" },
  { text: "Then repent soon after; Allah turns to them in mercy.", ref: "Qur'an 4:17" },
  { text: "And Allah is Knowing and Wise.", ref: "Qur'an 4:17" },
  { text: "But repentance is not for those who persist in evil deeds until death.", ref: "Qur'an 4:18" },
  { text: "Then say, 'Indeed, I repent now,' nor for those who die disbelievers.", ref: "Qur'an 4:18" },
  { text: "For them We have prepared a painful punishment.", ref: "Qur'an 4:18" },
  { text: "O you who believe, you are forbidden to inherit women against their will.", ref: "Qur'an 4:19" },
  { text: "And do not make difficulties for them to take back part of what you gave them.", ref: "Qur'an 4:19" },
  { text: "Unless they commit a clear immorality.", ref: "Qur'an 4:19" },
  { text: "And live with them in kindness.", ref: "Qur'an 4:19" },
  { text: "For if you dislike them, perhaps you dislike something and Allah makes therein much good.", ref: "Qur'an 4:19" },
  { text: "And if you want to replace one wife with another, even if you have given her a great amount, do not take anything from it.", ref: "Qur'an 4:20" },
  { text: "Would you take it by slander and manifest sin?", ref: "Qur'an 4:20" },
  { text: "And how could you take it when you have gone in unto each other?", ref: "Qur'an 4:21" },
  { text: "And they have taken from you a solemn covenant.", ref: "Qur'an 4:21" },
  { text: "And do not marry women your fathers married, except what has already passed.", ref: "Qur'an 4:22" },
  { text: "Indeed, it was an immorality and hateful and an evil way.", ref: "Qur'an 4:22" },
  { text: "Prohibited to you are your mothers, daughters, sisters, father's sisters, mother's sisters.", ref: "Qur'an 4:23" },
  { text: "And your brother's daughters, sister's daughters, and your nursing mothers.", ref: "Qur'an 4:23" },
  { text: "And your milk-sisters, and the mothers of your wives, and your step-daughters under your guardianship.", ref: "Qur'an 4:23" },
  { text: "Born of your wives you have gone in unto – but if you have not gone in unto them, no sin upon you.", ref: "Qur'an 4:23" },
  { text: "And the wives of your sons from your loins.", ref: "Qur'an 4:23" },
  { text: "And it is forbidden to have two sisters together, except what has already passed.", ref: "Qur'an 4:23" },
  { text: "And [also prohibited] married women except those your right hands possess.", ref: "Qur'an 4:24" },
  { text: "This is the decree of Allah upon you.", ref: "Qur'an 4:24" },
  { text: "And lawful to you are all beyond these, provided you seek them with your wealth in marriage, not in lust.", ref: "Qur'an 4:24" },
  { text: "So for whatever you enjoy from them, give them their due obligation.", ref: "Qur'an 4:24" },
  { text: "And there is no sin upon you for what you mutually agree after the obligation.", ref: "Qur'an 4:24" },
  { text: "And whoever does not have the means to marry free believing women, let him marry believing girls from among those your right hands possess.", ref: "Qur'an 4:25" },
  { text: "Allah knows most about your faith; you are from one another.", ref: "Qur'an 4:25" },
  { text: "So marry them with the permission of their people and give them their due compensation according to what is reasonable.", ref: "Qur'an 4:25" },
  { text: "They should be chaste, not committing immorality, nor taking secret lovers.", ref: "Qur'an 4:25" },
  { text: "Then if they commit immorality after marriage, they get half the punishment of free women.", ref: "Qur'an 4:25" },
  { text: "That is for those who fear hardship; but it is better for you to be patient.", ref: "Qur'an 4:25" },
  { text: "And Allah is Forgiving and Merciful.", ref: "Qur'an 4:25" },
  { text: "Allah wants to make clear to you and guide you to the ways of those before you.", ref: "Qur'an 4:26" },
  { text: "And to accept your repentance; and Allah is Knowing and Wise.", ref: "Qur'an 4:26" },
  { text: "Allah wants to accept your repentance, but those who follow desires want you to deviate greatly.", ref: "Qur'an 4:27" },
  { text: "Allah wants to lighten your burden; and mankind was created weak.", ref: "Qur'an 4:28" },
  { text: "O you who believe, do not consume one another's wealth unjustly, except in trade by mutual consent.", ref: "Qur'an 4:29" },
  { text: "And do not kill yourselves; indeed, Allah is ever Merciful to you.", ref: "Qur'an 4:29" },
  { text: "And whoever does that in aggression and injustice, We will drive him into a Fire.", ref: "Qur'an 4:30" },
  { text: "And that is easy for Allah.", ref: "Qur'an 4:30" },
  { text: "If you avoid the major sins you are forbidden, We will remove your minor sins.", ref: "Qur'an 4:31" },
  { text: "And admit you through a noble entrance.", ref: "Qur'an 4:31" },
  { text: "And do not wish for what Allah has given some of you over others.", ref: "Qur'an 4:32" },
  { text: "For men is a share of what they earn, and for women is a share of what they earn.", ref: "Qur'an 4:32" },
  { text: "And ask Allah of His bounty; indeed, Allah is ever Knowing of all things.", ref: "Qur'an 4:32" },
  { text: "And for all, We have made heirs to what parents and relatives leave.", ref: "Qur'an 4:33" },
  { text: "And those you have sworn allegiance to, give them their share.", ref: "Qur'an 4:33" },
  { text: "Indeed, Allah is ever Witness over all things.", ref: "Qur'an 4:33" },
  { text: "Men are the protectors and maintainers of women, for Allah has given one more than the other.", ref: "Qur'an 4:34" },
  { text: "And because they spend from their wealth.", ref: "Qur'an 4:34" },
  { text: "So righteous women are devoutly obedient, guarding in the husband's absence what Allah would have them guard.", ref: "Qur'an 4:34" },
  { text: "But those you fear may commit defiance, advise them and leave them in bed, and strike them lightly.", ref: "Qur'an 4:34" },
  { text: "But if they obey you, seek no means against them; indeed, Allah is ever Exalted and Great.", ref: "Qur'an 4:34" },
  { text: "And if you fear a breach between the two, appoint an arbitrator from his family and from her family.", ref: "Qur'an 4:35" },
  { text: "If they both desire reconciliation, Allah will cause it; indeed, Allah is ever Knowing and Acquainted.", ref: "Qur'an 4:35" },
  { text: "Worship Allah and associate nothing with Him, and be good to parents.", ref: "Qur'an 4:36" },
  { text: "And to relatives, orphans, the needy, the neighbor who is near, the neighbor who is stranger.", ref: "Qur'an 4:36" },
  { text: "And the companion at your side, the traveler, and those your right hands possess.", ref: "Qur'an 4:36" },
  { text: "Indeed, Allah does not like those who are self-deluded and boastful.", ref: "Qur'an 4:36" },
  { text: "Those who are stingy and enjoin people to be stingy, and conceal what Allah has given them of His bounty.", ref: "Qur'an 4:37" },
  { text: "And We have prepared for the disbelievers a humiliating punishment.", ref: "Qur'an 4:37" },
  { text: "And those who spend their wealth to be seen by people and do not believe in Allah nor the Last Day.", ref: "Qur'an 4:38" },
  { text: "And he to whom Satan is a companion – evil is the companion.", ref: "Qur'an 4:38" },
  { text: "And what would it harm them if they believed in Allah and the Last Day and spent from what Allah provided them?", ref: "Qur'an 4:39" },
  { text: "And Allah is ever Knowing of them.", ref: "Qur'an 4:39" },
  { text: "Indeed, Allah does not do injustice, even an atom's weight; if it is a good deed, He multiplies it.", ref: "Qur'an 4:40" },
  { text: "And gives from Himself a great reward.", ref: "Qur'an 4:40" },
  { text: "So how will it be when We bring forth a witness from every nation, and bring you as a witness against these?", ref: "Qur'an 4:41" },
  { text: "That Day, those who disbelieved and disobeyed the Messenger will wish the earth would be leveled over them.", ref: "Qur'an 4:42" },
  { text: "And they will not conceal from Allah any statement.", ref: "Qur'an 4:42" },
  { text: "O you who believe, do not approach prayer while intoxicated until you know what you are saying.", ref: "Qur'an 4:43" },
  { text: "Nor in a state of major impurity, except when passing through a place, until you have washed the whole body.", ref: "Qur'an 4:43" },
  { text: "If you are ill or on a journey, or one of you comes from relieving himself, or you have contacted women and find no water, then seek clean earth.", ref: "Qur'an 4:43" },
  { text: "And wipe your faces and your hands with it; indeed, Allah is Pardoning and Forgiving.", ref: "Qur'an 4:43" },
  { text: "Have you not seen those who were given a portion of the Scripture? They purchase error and wish you to go astray.", ref: "Qur'an 4:44" },
  { text: "But Allah knows your enemies; and sufficient is Allah as an ally, and sufficient is Allah as a helper.", ref: "Qur'an 4:45" },
  { text: "Among the Jews are those who distort words from their places.", ref: "Qur'an 4:46" },
  { text: "And they say, 'We hear and disobey,' and 'Hear without hearing,' and 'Ra'ina,' twisting their tongues and defaming the religion.", ref: "Qur'an 4:46" },
  { text: "If they had said, 'We hear and obey,' and 'Hear and consider,' it would have been better for them and more upright.", ref: "Qur'an 4:46" },
  { text: "But Allah cursed them for their disbelief, so they believe not except a little.", ref: "Qur'an 4:46" },
  { text: "O you who were given the Scripture, believe in what We have sent down confirming what is with you.", ref: "Qur'an 4:47" },
  { text: "Before We obliterate faces and turn them backward, or curse them as We cursed the Sabbath breakers.", ref: "Qur'an 4:47" },
  { text: "Indeed, Allah does not forgive association with Him, but He forgives what is less than that for whom He wills.", ref: "Qur'an 4:48" },
  { text: "And he who associates others with Allah has certainly fabricated a tremendous sin.", ref: "Qur'an 4:48" },
  { text: "Have you not seen those who claim themselves pure? Rather, Allah purifies whom He wills.", ref: "Qur'an 4:49" },
  { text: "And they are not wronged, even as much as a thread inside a date seed.", ref: "Qur'an 4:49" },
  { text: "Look how they invent about Allah untruth; and that is sufficient as a manifest sin.", ref: "Qur'an 4:50" },
  { text: "Have you not seen those given a portion of the Scripture, believing in magic and false deities?", ref: "Qur'an 4:51" },
  { text: "And saying about those who disbelieve, 'These are better guided than the believers as to the way.'", ref: "Qur'an 4:51" },
  { text: "Those are the ones Allah has cursed; and he whom Allah curses, you will never find a helper for him.", ref: "Qur'an 4:52" },
  { text: "Or have they a share of the dominion? Then in that case they would not give the people even a speck on a date stone.", ref: "Qur'an 4:53" },
  { text: "Or do they envy people for what Allah has given them of His bounty?", ref: "Qur'an 4:54" },
  { text: "We have given the family of Abraham the Scripture and wisdom and conferred upon them a great kingdom.", ref: "Qur'an 4:54" },
  { text: "And among them were those who believed in it, and among them were those who averted from it.", ref: "Qur'an 4:55" },
  { text: "And sufficient is Hell as a blaze.", ref: "Qur'an 4:55" },
  { text: "Indeed, those who disbelieve in Our verses, We will drive them into a Fire.", ref: "Qur'an 4:56" },
  { text: "Whenever their skins are roasted through, We will replace them with other skins so they may taste the punishment.", ref: "Qur'an 4:56" },
  { text: "Indeed, Allah is ever Exalted in Might and Wise.", ref: "Qur'an 4:56" },
  { text: "But those who believe and do righteous deeds, We will admit them to gardens beneath which rivers flow.", ref: "Qur'an 4:57" },
  { text: "Abiding therein forever; for them therein are purified spouses, and We will admit them to deep shade.", ref: "Qur'an 4:57" },
  { text: "Indeed, Allah commands you to render trusts to their owners.", ref: "Qur'an 4:58" },
  { text: "And when you judge between people, judge with justice.", ref: "Qur'an 4:58" },
  { text: "Excellent is that which Allah instructs you; indeed, Allah is ever Hearing and Seeing.", ref: "Qur'an 4:58" },
  { text: "O you who believe, obey Allah and obey the Messenger and those in authority among you.", ref: "Qur'an 4:59" },
  { text: "And if you disagree over anything, refer it to Allah and the Messenger.", ref: "Qur'an 4:59" },
  { text: "That is the best [way] and best in result.", ref: "Qur'an 4:59" },
  { text: "Have you not seen those who claim to believe in what was revealed to you and before you?", ref: "Qur'an 4:60" },
  { text: "They wish to refer legislation to false gods, while they were commanded to reject it.", ref: "Qur'an 4:60" },
  { text: "Satan wishes to lead them far astray.", ref: "Qur'an 4:60" },
  { text: "And when it is said to them, 'Come to what Allah has revealed and to the Messenger,' you see the hypocrites turning away.", ref: "Qur'an 4:61" },
  { text: "So how will it be when disaster strikes them for what their hands have sent forth?", ref: "Qur'an 4:62" },
  { text: "Then they come to you swearing by Allah, 'We intended nothing but good and reconciliation.'", ref: "Qur'an 4:62" },
  { text: "Those are the ones of whom Allah knows what is in their hearts, so turn away from them but admonish them.", ref: "Qur'an 4:63" },
  { text: "And say to them effective words.", ref: "Qur'an 4:63" },
  { text: "And We did not send any messenger except to be obeyed, by permission of Allah.", ref: "Qur'an 4:64" },
  { text: "And if, when they wronged themselves, they had come to you and asked forgiveness of Allah.", ref: "Qur'an 4:64" },
  { text: "And the Messenger had asked forgiveness for them, they would have found Allah Accepting of repentance, Merciful.", ref: "Qur'an 4:64" },
  { text: "But no, by your Lord, they will not believe until they make you judge concerning what they dispute.", ref: "Qur'an 4:65" },
  { text: "Then find within themselves no discomfort from your decision, and submit in full submission.", ref: "Qur'an 4:65" },
  { text: "And if We had decreed upon them, 'Kill yourselves' or 'Leave your homes,' they would not have done it, except a few.", ref: "Qur'an 4:66" },
  { text: "But if they had done what they were instructed, it would have been better and more firmly establishing.", ref: "Qur'an 4:66" },
  { text: "And then We would have given them from Us a great reward.", ref: "Qur'an 4:67" },
  { text: "And We would have guided them to a straight path.", ref: "Qur'an 4:68" },
  { text: "And whoever obeys Allah and the Messenger will be with those upon whom Allah has bestowed favor.", ref: "Qur'an 4:69" },
  { text: "Of the prophets, the truthful, the martyrs, and the righteous; and excellent are those as companions.", ref: "Qur'an 4:69" },
  { text: "That is the bounty from Allah; and sufficient is Allah as Knower.", ref: "Qur'an 4:70" },
  { text: "O you who believe, take your precautions and go forth in groups or all together.", ref: "Qur'an 4:71" },
  { text: "And indeed, among you is he who lingers behind; and if a disaster befalls you, he says, 'Allah has favored me that I was not present.'", ref: "Qur'an 4:72" },
  { text: "But if bounty comes to you from Allah, he will surely say, as if there had never been affection between you and him, 'Oh, I wish I had been with them and attained great attainment.'", ref: "Qur'an 4:73" },
  { text: "So let those fight in the cause of Allah who sell the life of this world for the Hereafter.", ref: "Qur'an 4:74" },
  { text: "And whoever fights in the cause of Allah and is killed or victorious, We will give him a great reward.", ref: "Qur'an 4:74" },
  { text: "And what is [the matter] with you that you do not fight in the cause of Allah and for the oppressed among men, women, and children?", ref: "Qur'an 4:75" },
  { text: "Those who say, 'Our Lord, take us out of this city of oppressive people and appoint for us from Yourself a protector and a helper.'", ref: "Qur'an 4:75" },
  { text: "Those who believe fight in the cause of Allah, and those who disbelieve fight in the cause of false deities.", ref: "Qur'an 4:76" },
  { text: "So fight against the allies of Satan; indeed, the plot of Satan has ever been weak.", ref: "Qur'an 4:76" },
  { text: "Have you not seen those who were told, 'Restrain your hands and establish prayer and give zakah'?", ref: "Qur'an 4:77" },
  { text: "Then when fighting was prescribed for them, a party of them feared men as they fear Allah or more.", ref: "Qur'an 4:77" },
  { text: "And they said, 'Our Lord, why have You decreed fighting for us? If only You had postponed it for us a little while.'", ref: "Qur'an 4:77" },
  { text: "Say, 'Enjoyment of this world is little, and the Hereafter is better for he who fears Allah.'", ref: "Qur'an 4:77" },
  { text: "And you will not be wronged, even as much as a thread inside a date seed.", ref: "Qur'an 4:77" },
  { text: "Wherever you may be, death will overtake you, even if you are in towers built up strong.", ref: "Qur'an 4:78" },
  { text: "And if good befalls them, they say, 'This is from Allah'; and if evil befalls them, they say, 'This is from you.'", ref: "Qur'an 4:78" },
  { text: "Say, 'All is from Allah.' What is [the matter] with these people that they hardly understand any statement?", ref: "Qur'an 4:78" },
  { text: "What comes to you of good is from Allah, and what comes to you of evil is from yourself.", ref: "Qur'an 4:79" },
  { text: "And We have sent you, [O Muhammad], as a messenger to the people; and sufficient is Allah as Witness.", ref: "Qur'an 4:79" },
  { text: "Whoever obeys the Messenger has obeyed Allah; and whoever turns away – We have not sent you as a guardian over them.", ref: "Qur'an 4:80" },
  { text: "And they say, '[We pledge] obedience.' But when they leave you, a group of them spends the night plotting other than what you say.", ref: "Qur'an 4:81" },
  { text: "But Allah records what they plot. So turn away from them and rely upon Allah; and sufficient is Allah as Disposer of affairs.", ref: "Qur'an 4:81" },
  { text: "Do they not reflect upon the Qur'an? If it had been from other than Allah, they would have found much contradiction.", ref: "Qur'an 4:82" },
  { text: "And when there comes to them information about security or fear, they spread it abroad.", ref: "Qur'an 4:83" },
  { text: "If they had referred it to the Messenger and those in authority among them, the ones who can draw conclusions would have known it.", ref: "Qur'an 4:83" },
  { text: "And if not for the bounty and mercy of Allah upon you, you would have followed Satan, except a few.", ref: "Qur'an 4:83" },
  { text: "So fight in the cause of Allah; you are not held responsible except for yourself.", ref: "Qur'an 4:84" },
  { text: "And urge the believers to fight; perhaps Allah will restrain the might of the disbelievers.", ref: "Qur'an 4:84" },
  { text: "And Allah is greater in might and greater in punishment.", ref: "Qur'an 4:84" },
  { text: "Whoever intercedes for a good cause will have a share of it; whoever intercedes for an evil cause will have a portion of it.", ref: "Qur'an 4:85" },
  { text: "And Allah is ever, over all things, a Keeper.", ref: "Qur'an 4:85" },
  { text: "And when you are greeted with a greeting, greet with one better than it or return it.", ref: "Qur'an 4:86" },
  { text: "Indeed, Allah is ever, over all things, an Accountant.", ref: "Qur'an 4:86" },
  { text: "Allah – there is no deity except Him. He will surely assemble you for the Day of Resurrection, there is no doubt about it.", ref: "Qur'an 4:87" },
  { text: "And who is more truthful than Allah in statement?", ref: "Qur'an 4:87" },
  { text: "What is [the matter] with you that you are two parties concerning the hypocrites, when Allah has cast them back for what they earned?", ref: "Qur'an 4:88" },
  { text: "Do you wish to guide those Allah has sent astray? And he whom Allah sends astray, you will never find a way for him.", ref: "Qur'an 4:88" },
  { text: "They wish you would disbelieve as they disbelieved, so you would be alike. So do not take from among them allies until they emigrate for the cause of Allah.", ref: "Qur'an 4:89" },
  { text: "But if they turn away, seize them and kill them wherever you find them and take not from among them any ally or helper.", ref: "Qur'an 4:89" },
  { text: "Except for those who join a group between whom and you there is a treaty, or those who come to you, their hearts restraining them from fighting you or their own people.", ref: "Qur'an 4:90" },
  { text: "And if Allah had willed, He could have given them power over you, and they would have fought you.", ref: "Qur'an 4:90" },
  { text: "So if they remove themselves from you and do not fight you and offer you peace, then Allah has not made for you a cause against them.", ref: "Qur'an 4:90" },
  { text: "You will find others who wish to obtain security from you and security from their own people.", ref: "Qur'an 4:91" },
  { text: "Every time they are returned to temptation, they fall into it.", ref: "Qur'an 4:91" },
  { text: "If they do not withdraw from you or offer you peace or restrain their hands, then seize them and kill them wherever you overtake them.", ref: "Qur'an 4:91" },
  { text: "And those – We have made for you against them a clear authorization.", ref: "Qur'an 4:91" },
  { text: "Never should a believer kill another believer, except by mistake.", ref: "Qur'an 4:92" },
  { text: "And whoever kills a believer by mistake must free a believing slave and pay compensation to his family, unless they remit it as charity.", ref: "Qur'an 4:92" },
  { text: "If the deceased was from a people at war with you and he was a believer – then freeing a believing slave.", ref: "Qur'an 4:92" },
  { text: "And if he was from a people with whom you have a treaty – then compensation to his family and freeing a believing slave.", ref: "Qur'an 4:92" },
  { text: "But if he cannot find one, then fasting for two consecutive months, as repentance to Allah.", ref: "Qur'an 4:92" },
  { text: "And Allah is ever Knowing and Wise.", ref: "Qur'an 4:92" },
  { text: "And whoever kills a believer intentionally, his recompense is Hell, abiding eternally therein.", ref: "Qur'an 4:93" },
  { text: "And Allah has become angry with him and has cursed him and prepared for him a great punishment.", ref: "Qur'an 4:93" },
  { text: "O you who believe, when you go forth in the cause of Allah, investigate carefully.", ref: "Qur'an 4:94" },
  { text: "And do not say to one who gives you a greeting of peace, 'You are not a believer.'", ref: "Qur'an 4:94" },
  { text: "Seeking the goods of worldly life; for with Allah are abundant gains.", ref: "Qur'an 4:94" },
  { text: "You were like that before, then Allah conferred His favor upon you, so investigate.", ref: "Qur'an 4:94" },
  { text: "Indeed, Allah is ever Acquainted with what you do.", ref: "Qur'an 4:94" },
  { text: "Not equal are those who remain seated among the believers, except those with disabilities, and the strivers in the cause of Allah with their wealth and lives.", ref: "Qur'an 4:95" },
  { text: "Allah has preferred the strivers over those who remain seated by a great reward.", ref: "Qur'an 4:95" },
  { text: "Degrees from Him and forgiveness and mercy; and Allah is ever Forgiving and Merciful.", ref: "Qur'an 4:96" },
  { text: "Indeed, those whom the angels take in death while wronging themselves, the angels will say, 'In what [condition] were you?'", ref: "Qur'an 4:97" },
  { text: "They will say, 'We were oppressed in the land.' The angels will say, 'Was not the earth of Allah spacious enough for you to emigrate?'", ref: "Qur'an 4:97" },
  { text: "For those, their refuge is Hell – and evil it is as a destination.", ref: "Qur'an 4:97" },
  { text: "Except for the oppressed among men, women, and children who cannot devise a plan and are not directed to a way.", ref: "Qur'an 4:98" },
  { text: "For those, perhaps Allah will pardon them; and Allah is ever Pardoning and Forgiving.", ref: "Qur'an 4:99" },
  { text: "And whoever emigrates for the cause of Allah will find on earth many places of refuge and abundance.", ref: "Qur'an 4:100" },
  { text: "And whoever leaves his home as an emigrant to Allah and His Messenger, then death overtakes him, his reward has become incumbent upon Allah.", ref: "Qur'an 4:100" },
  { text: "And Allah is ever Forgiving and Merciful.", ref: "Qur'an 4:100" },
  { text: "And when you travel in the land, there is no blame upon you for shortening prayer if you fear that those who disbelieve may attack you.", ref: "Qur'an 4:101" },
  { text: "Indeed, the disbelievers are ever to you a clear enemy.", ref: "Qur'an 4:101" },
  { text: "And when you are among them and lead them in prayer, let a group of them stand with you and carry their arms.", ref: "Qur'an 4:102" },
  { text: "And when they have prostrated, let them be behind you and let another group come that has not prayed and pray with you.", ref: "Qur'an 4:102" },
  { text: "And let them take their precautions and their arms.", ref: "Qur'an 4:102" },
  { text: "The disbelievers wish that you would neglect your weapons and your baggage, so they could come down upon you all at once.", ref: "Qur'an 4:102" },
  { text: "But there is no blame upon you if you lay aside your arms when you are troubled by rain or are ill; but take your precautions.", ref: "Qur'an 4:102" },
  { text: "Indeed, Allah has prepared for the disbelievers a humiliating punishment.", ref: "Qur'an 4:102" },
  { text: "And when you have completed the prayer, remember Allah standing, sitting, and on your sides.", ref: "Qur'an 4:103" },
  { text: "And when you are secure, then establish prayer. Indeed, prayer has been decreed upon the believers at specified times.", ref: "Qur'an 4:103" },
  { text: "And do not weaken in pursuit of the enemy. If you should be suffering, so are they suffering as you are suffering.", ref: "Qur'an 4:104" },
  { text: "But you expect from Allah what they expect not. And Allah is ever Knowing and Wise.", ref: "Qur'an 4:104" },
  { text: "Indeed, We have sent down to you the Book in truth so that you may judge between people by what Allah has shown you.", ref: "Qur'an 4:105" },
  { text: "And do not be for the deceitful an advocate.", ref: "Qur'an 4:105" },
  { text: "And seek forgiveness of Allah; indeed, Allah is ever Forgiving and Merciful.", ref: "Qur'an 4:106" },
  { text: "And do not argue on behalf of those who deceive themselves; indeed, Allah does not love those who are deceitful and sinful.", ref: "Qur'an 4:107" },
  { text: "They conceal from the people but they cannot conceal from Allah; He is with them when they spend the night plotting words He does not approve.", ref: "Qur'an 4:108" },
  { text: "And Allah is ever encompassing of what they do.", ref: "Qur'an 4:108" },
  { text: "Here you are – you argue for them in this worldly life, but who will argue for them before Allah on the Day of Resurrection, or who will be their defender?", ref: "Qur'an 4:109" },
  { text: "And whoever does a wrong or wrongs himself, then seeks forgiveness of Allah, he will find Allah Forgiving and Merciful.", ref: "Qur'an 4:110" },
  { text: "And whoever earns sin, he earns it only against himself; and Allah is ever Knowing and Wise.", ref: "Qur'an 4:111" },
  { text: "And whoever earns a fault or a sin, then throws it upon an innocent, he has burdened himself with slander and manifest sin.", ref: "Qur'an 4:112" },
  { text: "And if it were not for the favor of Allah upon you and His mercy, a group of them would have determined to mislead you.", ref: "Qur'an 4:113" },
  { text: "But they mislead not except themselves, and they harm you not at all.", ref: "Qur'an 4:113" },
  { text: "And Allah has sent down to you the Book and wisdom and has taught you that which you did not know. And ever has the favor of Allah upon you been great.", ref: "Qur'an 4:113" },
  { text: "No good is there in much of their private conversation, except for those who enjoin charity or that which is right or reconciliation between people.", ref: "Qur'an 4:114" },
  { text: "And whoever does that seeking the pleasure of Allah – then We are going to give him a great reward.", ref: "Qur'an 4:114" },
  { text: "And whoever opposes the Messenger after guidance has become clear and follows other than the way of the believers, We will give him what he has taken and drive him into Hell, and evil it is as a destination.", ref: "Qur'an 4:115" },
  { text: "Indeed, Allah does not forgive association with Him, but He forgives what is less than that for whom He wills.", ref: "Qur'an 4:116" },
  { text: "And he who associates others with Allah has certainly gone far astray.", ref: "Qur'an 4:116" },
  { text: "They call upon instead of Him none but female [deities], and they call upon none but a rebellious Satan, whom Allah has cursed.", ref: "Qur'an 4:117" },
  { text: "He said, 'I will surely take from among Your servants a specific portion. And I will mislead them, and arouse in them desires.'", ref: "Qur'an 4:118-119" },
  { text: "And I will command them so they will slit the ears of cattle, and I will command them so they will change the creation of Allah.'", ref: "Qur'an 4:119" },
  { text: "And whoever takes Satan as an ally instead of Allah has certainly sustained a clear loss.", ref: "Qur'an 4:119" },
  { text: "Satan promises them and arouses in them desires, but Satan promises them nothing except delusion.", ref: "Qur'an 4:120" },
  { text: "The refuge of those will be Hell, and they will not find any escape from it.", ref: "Qur'an 4:121" },
  { text: "But those who believe and do righteous deeds, We will admit them to gardens beneath which rivers flow, abiding eternally therein forever.", ref: "Qur'an 4:122" },
  { text: "It is the promise of Allah, which is truth; and who is more truthful than Allah in statement?", ref: "Qur'an 4:122" },
  { text: "It is not according to your wishes, nor the wishes of the People of the Scripture; whoever does evil will be recompensed for it.", ref: "Qur'an 4:123" },
  { text: "And he will not find besides Allah any protector or helper.", ref: "Qur'an 4:123" },
  { text: "And whoever does righteous deeds, whether male or female, while being a believer, those will enter Paradise and will not be wronged, even as much as the speck on a date stone.", ref: "Qur'an 4:124" },
  { text: "And who is better in religion than one who submits his face to Allah while being a doer of good and follows the religion of Abraham, inclining toward truth?", ref: "Qur'an 4:125" },
  { text: "And Allah took Abraham as an intimate friend.", ref: "Qur'an 4:125" },
  { text: "And to Allah belongs whatever is in the heavens and whatever is on the earth. And Allah is ever, over all things, encompassing.", ref: "Qur'an 4:126" },
  { text: "And they request from you a legal ruling concerning women. Say, 'Allah gives you a ruling about them and what is recited to you in the Book concerning orphan girls to whom you do not give what is ordained for them and you desire to marry them, and concerning the oppressed children, and that you stand for orphans in justice.'", ref: "Qur'an 4:127" },
  { text: "And whatever good you do, Allah is ever Knowing of it.", ref: "Qur'an 4:127" },
  { text: "And if a woman fears from her husband contempt or evasion, there is no sin upon them if they make terms of settlement between them – and settlement is best.", ref: "Qur'an 4:128" },
  { text: "And present in the souls is stinginess. But if you do good and fear Allah, then indeed Allah is ever Acquainted with what you do.", ref: "Qur'an 4:128" },
  { text: "You will never be able to deal justly between wives, even if you should strive to do so.", ref: "Qur'an 4:129" },
  { text: "But do not incline completely toward one and leave the other hanging. And if you amend and fear Allah, then Allah is ever Forgiving and Merciful.", ref: "Qur'an 4:129" },
  { text: "And if they separate, Allah will enrich each from His abundance; and Allah is ever All-Encompassing and Wise.", ref: "Qur'an 4:130" },
  { text: "And to Allah belongs whatever is in the heavens and whatever is on the earth. And We have instructed those who were given the Scripture before you and you to fear Allah.", ref: "Qur'an 4:131" },
  { text: "And if you disbelieve, then to Allah belongs whatever is in the heavens and whatever is on the earth. And Allah is ever Free of need and Praiseworthy.", ref: "Qur'an 4:131" },
  { text: "And to Allah belongs whatever is in the heavens and whatever is on the earth; and sufficient is Allah as Disposer of affairs.", ref: "Qur'an 4:132" },
  { text: "If He wills, He can take you away, O people, and bring others; and Allah is ever competent to do that.", ref: "Qur'an 4:133" },
  { text: "Whoever desires the reward of this world – then with Allah is the reward of this world and the Hereafter; and Allah is ever Hearing and Seeing.", ref: "Qur'an 4:134" },
  { text: "O you who believe, be persistently standing firm in justice, witnesses for Allah, even if it be against yourselves or parents and relatives.", ref: "Qur'an 4:135" },
  { text: "Whether one is rich or poor, Allah is more worthy of both. So do not follow [personal] inclination, lest you not be just.", ref: "Qur'an 4:135" },
  { text: "And if you distort or turn away, then indeed Allah is ever Acquainted with what you do.", ref: "Qur'an 4:135" },
  { text: "O you who believe, believe in Allah and His Messenger and the Book He sent down upon His Messenger and the Scripture He sent down before.", ref: "Qur'an 4:136" },
  { text: "And whoever disbelieves in Allah, His angels, His books, His messengers, and the Last Day has certainly gone far astray.", ref: "Qur'an 4:136" },
  { text: "Indeed, those who believed then disbelieved, then believed, then disbelieved, and then increased in disbelief – never will Allah forgive them, nor guide them to a way.", ref: "Qur'an 4:137" },
  { text: "Give tidings to the hypocrites that there is for them a painful punishment.", ref: "Qur'an 4:138" },
  { text: "Those who take disbelievers as allies instead of the believers. Do they seek with them honor? But indeed, honor belongs to Allah entirely.", ref: "Qur'an 4:139" },
  { text: "And it has already come down to you in the Book that when you hear the verses of Allah being rejected and ridiculed, do not sit with them until they enter into another conversation.", ref: "Qur'an 4:140" },
  { text: "Indeed, you would then be like them. Indeed, Allah will gather the hypocrites and disbelievers in Hell all together.", ref: "Qur'an 4:140" },
  { text: "Those who wait [and watch] you. Then if you gain a victory from Allah, they say, 'Were we not with you?'", ref: "Qur'an 4:141" },
  { text: "But if the disbelievers have a success, they say, 'Did we not gain advantage over you and protect you from the believers?'", ref: "Qur'an 4:141" },
  { text: "Allah will judge between you on the Day of Resurrection; and never will Allah give the disbelievers a way over the believers.", ref: "Qur'an 4:141" },
  { text: "Indeed, the hypocrites seek to deceive Allah, but He is deceiving them.", ref: "Qur'an 4:142" },
  { text: "And when they stand for prayer, they stand lazily, showing off to the people, and they remember Allah but little.", ref: "Qur'an 4:142" },
  { text: "Wavering between them, neither with these nor with those. And whoever Allah sends astray, you will never find a way for him.", ref: "Qur'an 4:143" },
  { text: "O you who believe, do not take disbelievers as allies instead of the believers. Do you wish to give Allah a clear case against yourselves?", ref: "Qur'an 4:144" },
  { text: "Indeed, the hypocrites will be in the lowest depths of the Fire, and you will never find a helper for them.", ref: "Qur'an 4:145" },
  { text: "Except for those who repent, correct themselves, hold fast to Allah, and are sincere in their religion for Allah; those are with the believers. And Allah will give the believers a great reward.", ref: "Qur'an 4:146" },
  { text: "What would Allah do with your punishment if you are grateful and believe? And Allah is ever Appreciative and Knowing.", ref: "Qur'an 4:147" },
  { text: "Allah does not like the public mention of evil except by one who has been wronged. And Allah is ever Hearing and Knowing.", ref: "Qur'an 4:148" },
  { text: "If you show good or conceal it or pardon an offense – indeed, Allah is ever Pardoning and Competent.", ref: "Qur'an 4:149" },
  { text: "Indeed, those who disbelieve in Allah and His messengers and wish to discriminate between Allah and His messengers and say, 'We believe in some and disbelieve in others,' and wish to adopt a way in between.", ref: "Qur'an 4:150" },
  { text: "Those are the disbelievers, truly. And We have prepared for the disbelievers a humiliating punishment.", ref: "Qur'an 4:151" },
  { text: "But those who believe in Allah and His messengers and do not discriminate between any of them – to those He is going to give their rewards. And Allah is ever Forgiving and Merciful.", ref: "Qur'an 4:152" }
];
// ─── Icons ────────────────────────────────────────────────────────────
const BellIcon = memo(({ color = H.white, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M12 3 C9 3 7 5.5 7 9 L7 13 L5 16 L19 16 L17 13 L17 9 C17 5.5 15 3 12 3 Z M10 18 A2 2 0 0 0 14 18"
      fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round"
    />
  </Svg>
));

const CheckIcon = memo(({ color = H.white, size = 13 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M20 6 L9 17 L4 12" stroke={color} strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
));

const RefreshIcon = memo(({ color = H.textMuted, size = 14 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M4 12 A8 8 0 0 1 12 4 A8 8 0 0 1 19 8 M19 8 L19 3 M19 8 L14 8"
      fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    />
  </Svg>
));

const ProgressRing = memo(({ progress, size = 78, color = H.gold, trackColor = "rgba(11,61,46,0.1)" }) => {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={5} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={5} fill="none"
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round"
          transform={`rotate(-90, ${size / 2}, ${size / 2})`}
        />
      </Svg>
    </View>
  );
});

const HeaderPattern = memo(({ w = SW, h = 130 }) => {
  const step = 40;
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const stars = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = c * step + (r % 2 === 0 ? 0 : step / 2);
      const cy = r * step;
      stars.push(`M${cx} ${cy - 6} L${cx + 6} ${cy} L${cx} ${cy + 6} L${cx - 6} ${cy} Z`);
    }
  }
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      {stars.map((d, i) => (
        <Path key={i} d={d} fill={H.gold} opacity={0.05} />
      ))}
    </Svg>
  );
});

// ─── Header ───────────────────────────────────────────────────────────
const HEADER_H = 168;

const CompactHeader = ({ userName, greetingKey, hijriDate, gregorianDate, unreadCount, onBellPress, onAvatarPress }) => {
  const { t } = useTranslation();
  const initial = (userName || "U").trim().charAt(0).toUpperCase();
  const [quoteIndex, setQuoteIndex] = useState(() => {
    const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    return dayOfYear % QURAN_VERSES.length;
  });
  const quoteFade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const iv = setInterval(() => {
      Animated.timing(quoteFade, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => {
        setQuoteIndex((i) => (i + 1) % QURAN_VERSES.length);
        Animated.timing(quoteFade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
      });
    }, 9000);
    return () => clearInterval(iv);
  }, []);

  const verse = QURAN_VERSES[quoteIndex];

  return (
    <View style={[hs.wrap, { height: HEADER_H }]}>
      <Svg width={SW} height={HEADER_H} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset={0} stopColor={H.headerDeep} />
            <Stop offset={1} stopColor={H.headerLight} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={HEADER_H} fill="url(#headerGrad)" />
      </Svg>
      <HeaderPattern w={SW} h={HEADER_H} />

      <View style={hs.row}>
        <AnimatedPressable style={hs.avatar} onPress={onAvatarPress} activeOpacity={0.8}>
          <Text allowFontScaling={false} style={hs.avatarTxt}>{initial}</Text>
        </AnimatedPressable>

        <View style={hs.mid}>
          <Text allowFontScaling={false} style={hs.greeting}>{t(greetingKey)}</Text>
          <Text allowFontScaling={false} style={hs.name} numberOfLines={1}>{userName || t("common.welcome")}</Text>
        </View>

        <AnimatedPressable accessibilityLabel={t("header.notifications")} onPress={onBellPress} style={hs.bell} activeOpacity={0.8}>
          <BellIcon />
          {unreadCount > 0 && (
            <View style={hs.badge}>
              <Text allowFontScaling={false} style={hs.badgeTxt}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
            </View>
          )}
        </AnimatedPressable>
      </View>

      <View style={hs.dateRow}>
        <Text allowFontScaling={false} style={hs.dateTxt}>{gregorianDate}</Text>
        <View style={hs.dateDot} />
        <Text allowFontScaling={false} style={hs.dateTxt}>{hijriDate}</Text>
      </View>

      <View style={hs.quoteDivider} />

      <Animated.View style={{ opacity: quoteFade, marginTop: 8 }}>
        <Text allowFontScaling={false} style={hs.quoteText} numberOfLines={1}>"{verse.text}"</Text>
      </Animated.View>
    </View>
  );
};

// ─── Upcoming prayer card ───────────────────────────────────────────────
const UpcomingPrayerCard = ({ item, timeUntil, progress }) => {
  const { t } = useTranslation();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, [item?.key]);

  const iqamahLabel = parseTimeStr(item?.iqamah, item?.key);
  const adhanLabel = parseTimeStr(item?.adhan, item?.key);

  return (
    <Animated.View style={[up.card, { opacity: fade }]}>
      <View style={up.left}>
        <Text allowFontScaling={false} style={up.label}>{t("sections.upcomingPrayer")}</Text>
        <Text allowFontScaling={false} style={[up.name, { color: item?.color || H.gold }]}>{item?.label}</Text>
        <Text allowFontScaling={false} style={up.iqamahTime}>{iqamahLabel}</Text>
        <Text allowFontScaling={false} style={up.adhanSub}>Adhan · {adhanLabel}</Text>
        {timeUntil && (
          <View style={[up.pill, { borderColor: item?.color || H.gold }]}>
            <Text allowFontScaling={false} style={[up.pillTxt, { color: item?.color || H.gold }]}>{timeUntil}</Text>
          </View>
        )}
      </View>
      <View style={up.right}>
        <ProgressRing progress={progress} size={78} color={item?.color || H.gold} />
      </View>
    </Animated.View>
  );
};

// ─── Timeline row - flex:1 so 5 rows always exactly fill remaining
// space without any JS measurement; checkmark reflects ONLY manual
// confirmation, never auto time ─
const TimelineRow = ({ item, status, confirmed, onToggle, isLast }) => {
  const { t } = useTranslation();
  const isNow = status === "now";
  const isNext = status === "next";
  const isMissed = status === "missed";

  return (
    <AnimatedPressable
      activeOpacity={0.75}
      onPress={() => onToggle(item.key)}
      style={[
        tl.row,
        { flex: 1, marginBottom: isLast ? 0 : 6 },
        { borderLeftColor: confirmed ? item.color : isMissed ? H.missed : "rgba(11,61,46,0.12)" },
        isNow && { backgroundColor: `${item.color}0D`, borderColor: item.color },
      ]}
    >
      <View style={[tl.dot, { borderColor: confirmed ? item.color : isMissed ? H.missed : item.color }, confirmed && { backgroundColor: item.color }]}>
        {confirmed && <CheckIcon color={H.white} size={12} />}
      </View>

      <View style={tl.info}>
        <Text allowFontScaling={false} style={[tl.name, isMissed && !confirmed && { color: H.missed }]}>{item.label}</Text>
        <Text allowFontScaling={false} style={tl.arabic}>{item.arabic}</Text>
      </View>

      <View style={tl.timesCol}>
        <Text allowFontScaling={false} style={tl.timePrayer}>{parseTimeStr(item.iqamah, item.key)}</Text>
        <Text allowFontScaling={false} style={tl.timeAdhan}>Adhan {parseTimeStr(item.adhan, item.key)}</Text>
      </View>

      {(isNow || isNext) && (
        <View style={[tl.badge, { borderColor: item.color }]}>
          <Text allowFontScaling={false} style={[tl.badgeTxt, { color: item.color }]}>
            {isNow ? t("prayerStatus.now") : t("prayerStatus.next")}
          </Text>
        </View>
      )}
    </AnimatedPressable>
  );
};

// ─── Main component ────────────────────────────────────────────────────
export default function HomeScreen({ navigation, route }) {
  const { t } = useTranslation();
  const bottomNavHeight = useBottomNavHeight();
  const currentRoute = route?.name || "Home";
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState(null);
  const [userStatus, setUserStatus] = useState(null);
  const [timings, setTimings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [prayerConfirmed, setPrayerConfirmed] = useState({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [chandaPending, setChandaPending] = useState(0);
  const [deenUnread, setDeenUnread] = useState(0);
  const CHANDA_PENDING_KEY = "chanda_pending_count";

  const headerAnim = useRef(new Animated.Value(0)).current;
  const wsRef = useRef(null);
  // Populated once by the mount-time user/status effect below, then reused
  // by the FCM setup and chanda-pending fetch so they don't each pay for
  // their own AsyncStorage/Keychain read during the post-login burst.
  const userRef = useRef(null);
  const tokenRef = useRef(null);
  // Mirrors the userRole state so fetchDeenUnread can stay identity-stable —
  // see the comment on fetchDeenUnread below.
  const userRoleRef = useRef(null);

  // Keyed to the user's own calendar day. toISOString() gave the UTC date, so in
  // India the day only turned over at 05:30 and a Fajr marked at 5 AM was filed
  // under yesterday. See utils/prayerDay.
  const todayDateStr = localDayKey();
  const trackerKey = trackerKeyFor(todayDateStr);
  const celebrationKey = celebrationKeyFor(todayDateStr);

  // Nothing may react to prayerConfirmed until the stored value has loaded,
  // or hydrating a day that is already complete would look like completing it.
  const [trackerHydrated, setTrackerHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Read only this day's own key. There used to be a fallback to the old
      // UTC-dated key, which was wrong between midnight and 05:30 IST: at that
      // hour the local date is already today while the UTC date is still
      // yesterday, so opening the app overnight copied YESTERDAY's completed
      // prayers into today and persisted them. Every prayer then showed as
      // already offered without the user marking anything. Losing a stale
      // one-off migration is far better than telling someone they have prayed
      // when they have not.
      const saved = await AsyncStorage.getItem(trackerKey);
      if (cancelled) return;
      if (saved) setPrayerConfirmed(JSON.parse(saved));
      setTrackerHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [trackerKey]);

  useEffect(() => {
    (async () => {
      try {
        const userData = await AsyncStorage.getItem("user");
        if (userData) {
          const user = JSON.parse(userData);
          userRef.current = user;
          const role = user.role || null;
          const roleChanged = userRoleRef.current !== role;
          userRoleRef.current = role;
          setUserName(user.name || "");
          setUserRole(role);
          setUserStatus(user.status || "ACTIVE");
          // The Deen badge is role-sensitive (imam/admin also count pending
          // questions). fetchDeenUnread may already have run with a null role
          // via the focus effect, so refresh just that one count now that the
          // real role is known — instead of letting a state change invalidate
          // the shared callbacks and re-fire the whole request burst.
          if (roleChanged && role) fetchDeenUnread();
        } else {
          setUserStatus("ACTIVE");
        }
      } catch (e) {
        setUserStatus("ACTIVE");
      }
      try {
        tokenRef.current = await getToken();
      } catch (_) {}
      // Verify status against DB in the background (JWT/cache may be stale) —
      // login already wrote a fresh status to AsyncStorage above, so initial
      // render trusts that instead of waiting on this network round trip.
      // Any drift (e.g. admin approved/disabled the account while the app
      // was open) still lands via setUserStatus once this resolves.
      try {
        const res = await authApiAxios({ method: "get", url: "/auth/status" });
        const liveStatus = res.data?.status;
        if (liveStatus) {
          setUserStatus(liveStatus);
          // Keep AsyncStorage in sync
          const raw = await AsyncStorage.getItem("user");
          if (raw) {
            const user = JSON.parse(raw);
            user.status = liveStatus;
            userRef.current = user;
            await AsyncStorage.setItem("user", JSON.stringify(user));
          }
        }
      } catch (_) {}
    })();
    // fetchDeenUnread is deliberately not in this dependency array. It is
    // declared further down the component body, so naming it here would be a
    // temporal-dead-zone ReferenceError — the array is evaluated during render,
    // before that const is initialized, whereas the call above runs inside an
    // async callback after mount. It is identity-stable (useCallback with []),
    // so there is nothing for this effect to react to anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000); // minute granularity is enough — only date/greeting text depends on this
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  // Offline-first: paint from cache immediately, then refresh from the
  // network in the background. A failed network call never clears the
  // screen - it just flags `isOffline` and keeps whatever's showing.
  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(PRAYER_CACHE_KEY);
        if (cached) {
          setTimings(JSON.parse(cached));
          setLoading(false);
        }
      } catch (e) {}
    })();
  }, []);

  const fetchPrayerTimes = useCallback(async () => {
    try {
      const response = await apiAxios({ method: "get", url: "/prayer/" });
      setTimings(response.data);
      setIsOffline(false);
      AsyncStorage.setItem(PRAYER_CACHE_KEY, JSON.stringify(response.data)).catch(() => {});
      syncPrayerTimesToLocalScheduler(response.data).catch(() => {});
    } catch (e) {
      setIsOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      // GET /announcements/ requires auth (it derives the caller's targeted
      // announcements from the JWT) — this was calling the auth-less apiAxios,
      // so it 401'd on every single call and silently fell through to the
      // catch block below on every login, never refreshing the cache it read
      // from. That's why announcements looked permanently stuck/stale.
      const response = await authApiAxios({ method: "get", url: "/announcements/" });
      const announcements = response.data || [];
      await AsyncStorage.setItem(ANNOUNCEMENTS_CACHE_KEY, JSON.stringify(announcements));
      const read = parseJsonArray(await AsyncStorage.getItem("read_announcements"));
      const count = computeUnreadAnnouncements(announcements, read);
      setUnreadCount(count);
      await AsyncStorage.setItem("badge_Announcement", String(count));
    } catch (e) {
      const cached = parseJsonArray(await AsyncStorage.getItem(ANNOUNCEMENTS_CACHE_KEY));
      const read = parseJsonArray(await AsyncStorage.getItem("read_announcements"));
      const count = computeUnreadAnnouncements(cached, read);
      setUnreadCount(count);
      await AsyncStorage.setItem("badge_Announcement", String(count));
    }
  }, []);

  const fetchChandaPending = useCallback(async () => {
    try {
      const cached = await AsyncStorage.getItem(CHANDA_PENDING_KEY);
      if (cached) setChandaPending(parseInt(cached, 10) || 0);
      const token = tokenRef.current || (await getToken());
      const response = await apiAxios({
        method: "get",
        url: "/user/chanda-summary",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const count = response.data?.pending_months ?? 0;
      setChandaPending(count);
      await AsyncStorage.setItem(CHANDA_PENDING_KEY, String(count));
      await AsyncStorage.setItem("badge_Donation", String(count));
    } catch (_) {}
  }, []);

  // Reads the role from a ref, NOT from the `userRole` state, and therefore
  // keeps a stable identity for the life of the screen.
  //
  // This used to be `[userRole]`. `userRole` starts null and is set a moment
  // later from AsyncStorage, so this callback's identity changed once on every
  // single mount — and it sits in the dependency array of BOTH the badge
  // useFocusEffect and the prayer/WebSocket mount effect below. That one state
  // change therefore re-fired /announcements/, /user/chanda-summary, /hadith
  // and /questions a second time, AND tore down and re-ran the prayer effect:
  // a second /prayer/ request racing the first one that still gates the
  // loading spinner, plus a WebSocket cancel/close/reconnect cycle. Reading
  // the role from a ref removes the identity change entirely; the effect below
  // refreshes the Deen count once the real role is known, so imam/admin
  // pending-question counts are still correct.
  const fetchDeenUnread = useCallback(async () => {
    const count = await getDeenUnreadCount(userRoleRef.current);
    setDeenUnread(count);
    await AsyncStorage.setItem("badge_Deen", String(count)).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await PrayerNotificationService.initialize();
        await PrayerNotificationService.rescheduleOnLaunch();
        await ensureExactAlarmPermission();
      } catch (_) {}
    })();
  }, []);

  // Badges (announcements, chanda) were only refreshed on mount + a 30s
  // timer, so reading an announcement and coming straight back to Home
  // could still show the old badge count for up to 30s. Home never
  // unmounts on the stack (it's below every pushed screen), so re-run the
  // fetch on every focus, not just once.
  // These three drive badge counts only — none of them gates what the user
  // sees. Running them immediately meant five requests (/announcements/,
  // /user/chanda-summary, /hadith, /questions, and /questions/pending for
  // staff roles) hit the backend at the same instant as /prayer/, which is
  // the one call the loading spinner actually waits on. Deferring past the
  // first interaction frame lets the gating request have the connection to
  // itself; the badges land a few hundred ms later, which is invisible.
  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        fetchUnreadCount();
        fetchChandaPending();
        fetchDeenUnread();
      });
      return () => task.cancel();
    }, [fetchUnreadCount, fetchChandaPending, fetchDeenUnread])
  );

  // fetchUnreadCount/fetchChandaPending/fetchDeenUnread are intentionally NOT
  // called here — useFocusEffect below already runs them on Home's first
  // focus (which coincides with this first mount) and on every focus after.
  // Calling them again here used to fire each of those three requests twice
  // back-to-back on every login, doubling the post-login request burst.
  useEffect(() => {
    fetchPrayerTimes();

    let active = true;

    // Deferred past the initial paint/interactions so it doesn't compete
    // with the fetches above for the same just-woken (possibly cold-start)
    // backend connection.
    const wsTask = InteractionManager.runAfterInteractions(async () => {
      if (!active) return;
      try {
        const wsUrl = await getWsUrl("/ws/prayer");
        if (!active) return;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "prayer_updated") {
              setTimings(data.data);
              setIsOffline(false);
              AsyncStorage.setItem(PRAYER_CACHE_KEY, JSON.stringify(data.data)).catch(() => {});
              syncPrayerTimesToLocalScheduler(data.data).catch(() => {});
            }
          } catch (e) {}
        };
      } catch {}
    });

    const pollInterval = setInterval(() => {
      fetchPrayerTimes();
      fetchUnreadCount();
      fetchDeenUnread();
    }, 30000);

    return () => {
      active = false;
      wsTask.cancel();
      clearInterval(pollInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchPrayerTimes, fetchUnreadCount, fetchDeenUnread]);

  useEffect(() => {
    let unsubMessage = () => {};
    let unsubOpen = () => {};
    let unsubTokenRefresh = () => {};

    const setupNotifications = async () => {
      // Step 1: verify Firebase Messaging is initialized
      const fcm = messaging();
      logger.log("[FCM] Messaging initialized:", !!fcm);

      // Step 2: request permission and log result
      let granted = false;
      if (Platform.OS === "ios") {
        const status = await fcm.requestPermission();
        granted = status === messaging.AuthorizationStatus.AUTHORIZED ||
                  status === messaging.AuthorizationStatus.PROVISIONAL;
        logger.log("[FCM] iOS permission status:", status, "granted:", granted);
      } else if (Platform.Version >= 33) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        granted = result === PermissionsAndroid.RESULTS.GRANTED;
        logger.log("[FCM] Android POST_NOTIFICATIONS result:", result, "granted:", granted);
      } else {
        granted = true;
        logger.log("[FCM] Android < 13 — permission auto-granted");
      }

      if (!granted) {
        logger.log("[FCM] Permission denied — notifications disabled");
        return;
      }

      // Step 3: subscribe to announcements + prayer_times topics and role topics
      try {
        await subscribeToTopic(fcm, "announcements");
        await subscribeToTopic(fcm, "prayer_times"); // silent data updates for rescheduling alarms
        logger.log("[FCM] Subscribed to announcements + prayer_times");
      } catch (e) {
        logger.log("[FCM ERROR] Topic subscription failed:", e);
      }

      // Step 4: get device token, log it, and register with backend
      try {
        const token = await getFcmToken(fcm);
        logger.log("[FCM] Device token acquired:", token ? `${token.slice(0, 8)}…` : null);
        if (token) {
          let userObj = userRef.current;
          if (!userObj) {
            const userRaw = await AsyncStorage.getItem("user");
            userObj = userRaw ? JSON.parse(userRaw) : null;
          }
          await registerFcmToken(token, userObj?.role, tokenRef.current);
          await subscribeRoleTopics(fcm, userObj?.role);
        }
      } catch (e) {
        logger.log("[FCM ERROR] getToken/register failed:", e);
      }

      unsubTokenRefresh = onTokenRefresh(fcm, async (newToken) => {
        logger.log("[FCM] Token refreshed:", newToken ? `${newToken.slice(0, 8)}…` : null);
        try {
          const userRaw = await AsyncStorage.getItem("user");
          const userObj = userRaw ? JSON.parse(userRaw) : null;
          await registerFcmToken(newToken, userObj?.role);
        } catch {}
      });
      unsubMessage = onMessage(fcm, async (remoteMessage) => {
        const msgType = remoteMessage.data?.type;

        // Silent data messages (prayer schedule updates) — handle quietly, no alert
        if (msgType === "prayer_times_updated") {
          try {
            const data = remoteMessage.data;
            const prayerTimes = {
              adhan: {
                fajr:    data.fajr_adhan,
                dhuhr:   data.dhuhr_adhan,
                asr:     data.asr_adhan,
                maghrib: data.maghrib_adhan,
                isha:    data.isha_adhan,
              },
              prayer: {
                fajr:          data.fajr,
                dhuhr:         data.dhuhr,
                asr:           data.asr,
                maghrib:       data.maghrib,
                isha:          data.isha,
                jummah:        data.jummah,
                jummah_iqamah: data.jummah_iqamah,
              },
            };
            await PrayerNotificationService.savePrayerTimes(prayerTimes);
          } catch {}
          return;
        }
        if (await handlePrayerFcmMessage(remoteMessage)) return;

        // Registration approved — unlock the home screen
        if (msgType === "registration_approved") {
          setUserStatus("ACTIVE");
          try {
            const raw = await AsyncStorage.getItem("user");
            if (raw) {
              const user = JSON.parse(raw);
              user.status = "ACTIVE";
              await AsyncStorage.setItem("user", JSON.stringify(user));
            }
          } catch (_) {}
        }

        // Suppress announcement notifications the current user sent themselves
        const senderUserId = remoteMessage.data?.sender_user_id;
        if (senderUserId) {
          try {
            const meRaw = await AsyncStorage.getItem("user");
            const me = meRaw ? JSON.parse(meRaw) : null;
            if (me && String(me.id) === String(senderUserId)) return;
          } catch (_) {}
        }

        // Visible push notification (approval, hadith, questions, answers,
        // announcements, finance, etc.) — fire a real local notification so
        // it plays sound + shows a tray banner instead of a silent Alert.
        const title = remoteMessage.notification?.title;
        const body  = remoteMessage.notification?.body;
        if (title || body) showGenericPush(title, body, remoteMessage.data);
      });
      unsubOpen = onNotificationOpenedApp(fcm, () => {});
    };

    // Deferred past the initial paint/interactions — FCM permission prompts,
    // topic subscriptions and device registration are independent of the
    // login flow and shouldn't compete with the prayer/announcements/chanda
    // fetches for the same just-woken backend connection.
    const notificationsTask = InteractionManager.runAfterInteractions(() => {
      setupNotifications().catch((e) => logger.log("[FCM ERROR] setupNotifications:", e));
    });

    return () => {
      notificationsTask.cancel();
      unsubMessage();
      unsubOpen();
      unsubTokenRefresh();
    };
  }, []);

  const toggleConfirm = useCallback(
    (key) => {
      setPrayerConfirmed((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        AsyncStorage.setItem(trackerKey, JSON.stringify(next));
        return next;
      });
      Vibration.vibrate(25);
    },
    [trackerKey]
  );

  const friday = isFriday();
  const prayerList = useMemo(() => buildPrayerList(timings, friday, t), [timings, friday, t]);

  // ── Five-prayer celebration ───────────────────────────────────────────────
  // Fires on the TRANSITION to all-five-complete, not on the state itself, so it
  // never appears merely because Home re-rendered, a tab changed, or the app was
  // reopened on a day already finished. Two independent guards:
  //
  //   1. lastAllDoneRef starts as null and is seeded only once the stored
  //      tracker has loaded — hydrating a completed day sets it to true without
  //      ever being a false -> true edge.
  //   2. A date-keyed flag in AsyncStorage, so even a genuine edge (untick the
  //      fifth prayer, tick it again) shows it only once that day. It becomes
  //      eligible again tomorrow because the key carries the local date.
  //
  // Prayer marks are local-only, so there is no later sync to re-trigger this.
  const [showCelebration, setShowCelebration] = useState(false);
  const lastAllDoneRef = useRef(null);

  useEffect(() => {
    if (!trackerHydrated) return;

    // On Friday the list carries `jummah` in place of `dhuhr`, so read the keys
    // off the rendered list rather than assuming a fixed set.
    const keys = prayerList.map((p) => p.key);
    const allDone = keys.length === 5 && keys.every((k) => prayerConfirmed[k]);

    const previous = lastAllDoneRef.current;
    lastAllDoneRef.current = allDone;

    if (previous === null) return;        // first pass after hydration — seed only
    if (!allDone || previous) return;     // only the false -> true edge

    let cancelled = false;
    AsyncStorage.getItem(celebrationKey).then((already) => {
      if (cancelled || already) return;
      AsyncStorage.setItem(celebrationKey, "1");   // written before showing, so a
      setShowCelebration(true);                    // crash mid-animation cannot repeat it
    });
    return () => { cancelled = true; };
  }, [trackerHydrated, prayerConfirmed, prayerList, celebrationKey]);
  const nextIndex = useMemo(() => getNextIndex(prayerList), [prayerList, currentTime]);
  const timeUntil = useMemo(() => getTimeUntil(prayerList, nextIndex), [prayerList, nextIndex, currentTime]);
  const windowProgress = useMemo(() => getWindowProgress(prayerList, nextIndex), [prayerList, nextIndex, currentTime]);

  // ── Pending approval — complete lockout ──────────────────────────────
  if (userStatus === "PENDING_APPROVAL") {
    return (
      <View style={s.container}>
        <View style={pending.root}>
          {/* Mosque icon header */}
          <View style={pending.iconWrap}>
            <Svg width={64} height={54} viewBox="0 0 200 170">
              <Defs>
                <LinearGradient id="lgPend1" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset={0} stopColor="#E8C97A" />
                  <Stop offset={1} stopColor="#C9A84C" />
                </LinearGradient>
              </Defs>
              <Rect x="10" y="80" width="18" height="70" rx="2" fill="url(#lgPend1)" />
              <Rect x="6" y="75" width="26" height="8" rx="3" fill="#E8C97A" />
              <Path d="M14 75 Q19 58 24 75 Z" fill="#C9A84C" />
              <Rect x="172" y="80" width="18" height="70" rx="2" fill="url(#lgPend1)" />
              <Rect x="168" y="75" width="26" height="8" rx="3" fill="#E8C97A" />
              <Path d="M176 75 Q181 58 186 75 Z" fill="#C9A84C" />
              <Rect x="30" y="105" width="140" height="65" rx="3" fill="url(#lgPend1)" />
              <Path d="M83 170 L83 130 A17 17 0 0 1 117 130 L117 170 Z" fill="#0B3D2E" />
              <Path d="M30 105 A20 22 0 0 1 70 105 Z" fill="#C9A84C" />
              <Path d="M130 105 A20 22 0 0 1 170 105 Z" fill="#C9A84C" />
              <Path d="M55 105 A45 50 0 0 1 145 105 Z" fill="#C9A84C" />
              <Rect x="30" y="102" width="140" height="4" rx="1" fill="#E8C97A" />
            </Svg>
          </View>

          <Text allowFontScaling={false} style={pending.masjid}>Mohideen Masjid</Text>

          <View style={pending.card}>
            {/* Pulsing status dot */}
            <View style={pending.dotRow}>
              <View style={pending.dot} />
              <Text allowFontScaling={false} style={pending.statusLabel}>Pending Approval</Text>
            </View>

            <Text allowFontScaling={false} style={pending.title}>
              Your registration is under review
            </Text>
            <Text allowFontScaling={false} style={pending.body}>
              An admin will review your account shortly. You'll receive a notification as soon as you're approved and can access the app.
            </Text>

            <View style={pending.divider} />

            <Text allowFontScaling={false} style={pending.hint}>
              Registered as{" "}
              <Text style={pending.hintBold}>{userName || "Unknown"}</Text>
            </Text>
          </View>

          <AnimatedPressable
            style={pending.logoutBtn}
            onPress={async () => {
              try { await apiAxios({ method: "post", url: "/auth/logout" }); } catch (_) {}
              await deleteToken();
              await deleteRefreshToken();
              navigation.reset({ index: 0, routes: [{ name: "Login" }] });
            }}
          >
            <Text allowFontScaling={false} style={pending.logoutTxt}>Sign Out</Text>
          </AnimatedPressable>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={s.container}>
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color={H.gold} />
          <Text allowFontScaling={false} style={s.loadingText}>{t("common.loading")}</Text>
        </View>
        <BottomNav navigation={navigation} currentRoute={currentRoute} badges={{ Donation: chandaPending, Announcement: unreadCount, Deen: deenUnread }} />
      </View>
    );
  }

  // Genuinely nothing to show - first ever launch, no cache, no network.
  if (!timings) {
    return (
      <View style={s.container}>
        <View style={s.emptyState}>
          <Text allowFontScaling={false} style={s.errorTxt}>{t("errors.loadPrayerTimes")}</Text>
          <AnimatedPressable onPress={fetchPrayerTimes} style={s.retryBtn}>
            <Text allowFontScaling={false} style={s.retryTxt}>{t("errors.retry")}</Text>
          </AnimatedPressable>
        </View>
        <BottomNav navigation={navigation} currentRoute={currentRoute} badges={{ Donation: chandaPending, Announcement: unreadCount, Deen: deenUnread }} />
      </View>
    );
  }

  return (
    <View style={s.container}>

      <Animated.View style={{ opacity: headerAnim }}>
        <CompactHeader
          userName={userName}
          greetingKey={getGreetingKey(currentTime.getHours())}
          hijriDate={getHijriDateString(currentTime)}
          gregorianDate={currentTime.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
          unreadCount={unreadCount}
          onBellPress={() => navigation.navigate("Announcement")}
          onAvatarPress={() => navigation.navigate("Profile")}
        />
      </Animated.View>

      <View style={[s.body, { paddingBottom: bottomNavHeight }]}>
        <UpcomingPrayerCard item={prayerList[nextIndex]} timeUntil={timeUntil} progress={windowProgress} />

        <View style={s.timelineHeader}>
          <Text allowFontScaling={false} style={s.sectionTitle}>{t("sections.prayerTimeline")}</Text>
          {isOffline ? (
            <AnimatedPressable onPress={fetchPrayerTimes} style={s.offlinePill}>
              <RefreshIcon />
              <Text allowFontScaling={false} style={s.offlinePillTxt}>Offline · last saved</Text>
            </AnimatedPressable>
          ) : (
            <Text allowFontScaling={false} style={s.sectionArabic}>{t("sections.prayerTimelineArabic")}</Text>
          )}
        </View>

        <View style={s.timelineList}>
          {prayerList.map((item, i) => {
            const mins = timeToMinutes(primaryTime(item), primaryKeyFor(item));
            const confirmed = !!prayerConfirmed[item.key];
            let status = "upcoming";
            if (i === nextIndex) status = "next";
            else if (mins !== null && mins <= getCurrentMinutes() && i !== nextIndex) {
              status = confirmed ? "done" : "missed";
            }
            return (
              <TimelineRow
                key={item.key}
                item={item}
                status={status}
                confirmed={confirmed}
                onToggle={toggleConfirm}
                isLast={i === prayerList.length - 1}
              />
            );
          })}
        </View>
      </View>

      <BottomNav navigation={navigation} currentRoute={currentRoute} badges={{ Donation: chandaPending, Announcement: unreadCount, Deen: deenUnread }} />

      <FivePrayerCelebration
        visible={showCelebration}
        onDismiss={() => setShowCelebration(false)}
        t={t}
      />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const pending = StyleSheet.create({
  root:        { flex: 1, backgroundColor: H.headerDeep, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  iconWrap:    { marginBottom: 16 },
  masjid:      { fontSize: 18, fontWeight: "700", color: "#E8C97A", letterSpacing: 0.8, marginBottom: 28 },
  card:        { width: "100%", backgroundColor: "#FFFFFF", borderRadius: 20, padding: 24, marginBottom: 24,
                 shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 10 },
  dotRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  dot:         { width: 10, height: 10, borderRadius: 5, backgroundColor: "#E8A000" },
  statusLabel: { fontSize: 11, fontWeight: "800", color: "#B07A10", letterSpacing: 1.2, textTransform: "uppercase" },
  title:       { fontSize: 18, fontWeight: "700", color: "#152219", marginBottom: 10, lineHeight: 24 },
  body:        { fontSize: 14, color: "#4A6B5A", lineHeight: 21 },
  divider:     { height: 1, backgroundColor: "rgba(21,34,25,0.08)", marginVertical: 16 },
  hint:        { fontSize: 13, color: "#7A9B8A" },
  hintBold:    { fontWeight: "700", color: "#152219" },
  logoutBtn:   { paddingVertical: 13, paddingHorizontal: 40, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(232,201,122,0.5)" },
  logoutTxt:   { fontSize: 14, fontWeight: "700", color: "#E8C97A" },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: H.bg },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: H.bg, gap: 16 },
  loadingText: { color: H.textMuted, fontSize: 14, fontWeight: "500" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  errorTxt: { color: H.textMuted, fontSize: 14, textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: H.gold },
  retryTxt: { color: H.headerDeep, fontWeight: "700", fontSize: 13 },

  // paddingBottom is set dynamically at the call site via useBottomNavHeight()
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },

  timelineHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, marginBottom: 8 },
  sectionTitle: { color: H.textDark, fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
  sectionArabic: { color: H.textMuted, fontSize: 11 },
  offlinePill: {
    flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(154,163,158,0.14)",
    borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4,
  },
  offlinePillTxt: { fontSize: 10, color: H.textMuted, fontWeight: "700" },

  timelineList: { flex: 1, paddingBottom: 8 },
});

const hs = StyleSheet.create({
  wrap: { paddingHorizontal: 20, overflow: "hidden", borderBottomLeftRadius: 26, borderBottomRightRadius: 26, ...shadow(8, 0.18), paddingTop: 18, },
  row: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1.5, borderColor: H.goldLight, alignItems: "center", justifyContent: "center",
  },
  avatarTxt: { color: H.white, fontSize: 15, fontWeight: "700" },
  mid: { flex: 1, marginLeft: 12 },
  greeting: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "600" },
  name: { color: H.white, fontSize: 16, fontWeight: "700", marginTop: 1 },
  bell: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1, borderColor: "rgba(212,175,55,0.4)", alignItems: "center", justifyContent: "center",
  },
  badge: {
    position: "absolute", top: -3, right: -3, backgroundColor: H.error, borderRadius: 9,
    minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
    borderWidth: 1.5, borderColor: H.headerDeep,
  },
  badgeTxt: { color: H.white, fontSize: 8, fontWeight: "900" },
  dateRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 },
  dateTxt: { color: "rgba(255,255,255,0.6)", fontSize: 10.5, fontWeight: "600" },
  dateDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: H.goldLight },
  quoteDivider: { height: 1, backgroundColor: "rgba(212,175,55,0.25)", marginTop: 10 },
  quoteText: { color: H.goldLight, fontSize: 12, fontStyle: "italic" },
});

const up = StyleSheet.create({
  card: {
    flexDirection: "row", backgroundColor: H.card, borderRadius: 20, padding: 16,
    borderWidth: 1, borderColor: H.cardBorder, ...shadow(5, 0.07),
  },
  left: { flex: 1 },
  label: { fontSize: 10, color: H.textMuted, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  name: { fontSize: 20, fontWeight: "800", marginTop: 4 },
  iqamahTime: { fontSize: 24, color: H.textDark, fontWeight: "800", marginTop: 6 },
  adhanSub: { fontSize: 11, color: H.textMuted, fontWeight: "600", marginTop: 1 },
  pill: { marginTop: 8, alignSelf: "flex-start", borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 3 },
  pillTxt: { fontSize: 10, fontWeight: "800" },
  right: { alignItems: "center", justifyContent: "center", marginLeft: 10 },
});

const tl = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", backgroundColor: H.card, borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(11,61,46,0.06)", borderLeftWidth: 3,
    paddingHorizontal: 12, ...shadow(1, 0.03),
  },
  dot: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center", marginRight: 10,
  },
  info: { flex: 1 },
  name: { fontSize: 13.5, fontWeight: "700", color: H.textDark },
  arabic: { fontSize: 11, color: H.textMuted, marginTop: 1 },
  timesCol: { alignItems: "flex-end", marginRight: 8 },
  timePrayer: { fontSize: 14, fontWeight: "800", color: H.textDark },
  timeAdhan: { fontSize: 9.5, color: H.textMuted, marginTop: 1 },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTxt: { fontSize: 8, fontWeight: "900", letterSpacing: 0.4 },
});
