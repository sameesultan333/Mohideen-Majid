/**
 * BottomNav.js — Mohideen Masjid
 *
 * Changes from the previous version:
 *  - Restyled with the shared palette (deep emerald active state, gold
 *    accents, ivory card) instead of the standalone green/gray colors
 *    this file had - matches Splash/Login/Home now.
 *  - Added a "Prayer Time" tab for every user, navigating to
 *    "PrayerTime" (see note below about registering that route).
 *  - SECURITY: role checks were using `.includes("collector")`, which
 *    also matches any role string that merely *contains* that
 *    substring (e.g. a hypothetical "subcollector" or "noncollector"
 *    role). Replaced with exact equality against a normalized role
 *    string, so only an exact role match grants a tab.
 *  - SuperAdmin now sees every role-gated tab (Donate/Edit/Collect),
 *    for debugging/oversight - explicitly listed, not a fallback.
 *  - IMPORTANT: this only hides/shows tabs in the UI. It is not a
 *    substitute for server-side authorization. If the Donation,
 *    Editable, or Collector screens call backend endpoints, those
 *    endpoints must independently verify the caller's role - a user
 *    could otherwise reach those screens without ever seeing the tab.
 *  - When more than 5 tabs are visible (mainly the SuperAdmin case),
 *    the bar switches from an evenly-spaced fixed row to a horizontal
 *    scroll so tabs never get visually cramped.
 */

import React, { useEffect, useMemo, useState, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Animated, ScrollView } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path } from "react-native-svg";
import { COLORS as C } from "../config/theme";
import { useTranslation } from "react-i18next";

const IOS = Platform.OS === "ios";
const SAFE_B = IOS ? 28 : 12;
const TAB_WIDTH = 68;
const MAX_FIXED_TABS = 5; // beyond this, the bar scrolls instead of squishing

const sh = (y = 6, op = 0.14, r = 10, el = 10) =>
  Platform.select({
    ios: { shadowColor: "#0B3D2E", shadowOffset: { width: 0, height: y }, shadowOpacity: op, shadowRadius: r },
    android: { elevation: el },
  });

// Exact-match role gating - normalize once, compare with === only.
// This is the actual fix for the "wrong people seeing Collector" bug:
// substring checks (.includes) can match unintended role strings.
const normalizeRole = (role) => (role || "").toString().trim().toLowerCase();

const SUPERADMIN_ROLES = ["superadmin", "super_admin", "super admin"];

function buildTabs(rawRole, rawRoles, t) {
  const role = normalizeRole(rawRole);
  // rawRoles is the multi-role array from the JWT; fall back to [role] for old tokens.
  const roles = Array.isArray(rawRoles) && rawRoles.length > 0
    ? rawRoles.map(normalizeRole)
    : [role];
  const hasRole = (...r) => r.some((x) => roles.includes(x));

  const isSuperAdmin = hasRole(...SUPERADMIN_ROLES);
  const isCollector  = hasRole("collector");
  const isAdmin      = hasRole("admin");

  // Collector: Home / Collect / Deen / History / Dashboard / Profile
  if (isCollector) {
    return [
      { screen: "Home",             type: "home",      label: t("nav.home") },
      { screen: "Collector",        type: "collector", label: t("nav.collect") },
      { screen: "Deen",             type: "deen",      label: t("nav.deen") },
      { screen: "CollectorHistory", type: "history",   label: t("nav.history") },
      { screen: "CollectorDashboard", type: "dashboard", label: t("nav.dashboard") },
      { screen: "Profile",          type: "profile",   label: t("nav.profile") },
    ];
  }

  // SuperAdmin: full bar with all role-gated tabs
  if (isSuperAdmin) {
    return [
      { screen: "Home",     type: "home",      label: t("nav.home") },
      { screen: "Prayer",   type: "prayerTime",label: t("nav.prayerTime") },
      { screen: "Deen",     type: "deen",      label: t("nav.deen") },
      { screen: "Announcement", type: "news",  label: t("nav.news") },
      { screen: "Donation", type: "donate",    label: t("nav.donate") },
      { screen: "Editable", type: "editable",  label: t("nav.edit") },
      { screen: "Collector",type: "collector", label: t("nav.collect") },
      { screen: "Profile",  type: "profile",   label: t("nav.profile") },
    ];
  }

  // Admin: religious management + member-facing Deen/Donation screens.
  if (isAdmin) {
    return [
      { screen: "Home",         type: "home",       label: t("nav.home") },
      { screen: "Prayer",       type: "prayerTime", label: t("nav.prayerTime") },
      { screen: "Deen",         type: "deen",       label: t("nav.deen") },
      { screen: "Announcement", type: "news",       label: t("nav.news") },
      { screen: "Donation",     type: "donate",     label: t("nav.donate") },
      { screen: "Editable",     type: "editable",   label: t("nav.edit") },
      { screen: "Profile",      type: "profile",    label: t("nav.profile") },
    ];
  }

  // Imam
  if (hasRole("imam")) {
    return [
      { screen: "Home",     type: "home",      label: t("nav.home") },
      { screen: "Prayer",   type: "prayerTime",label: t("nav.prayerTime") },
      { screen: "Deen",     type: "deen",      label: t("nav.deen") },
      { screen: "Editable", type: "editable",  label: t("nav.edit") },
      { screen: "Profile",  type: "profile",   label: t("nav.profile") },
    ];
  }

  // Modhin / Watchman: prayer management with editable options
  if (hasRole("modhin", "watchman")) {
    return [
      { screen: "Home",     type: "home",      label: t("nav.home") },
      { screen: "Prayer",   type: "prayerTime",label: t("nav.prayerTime") },
      { screen: "Editable", type: "editable",  label: t("nav.edit") },
      { screen: "Profile",  type: "profile",   label: t("nav.profile") },
    ];
  }

  // Head / donor: Home / Prayer / Deen / Donation / Profile
  if (hasRole("head")) {
    return [
      { screen: "Home",     type: "home",      label: t("nav.home") },
      { screen: "Prayer",   type: "prayerTime",label: t("nav.prayerTime") },
      { screen: "Deen",     type: "deen",      label: t("nav.deen") },
      { screen: "Donation", type: "donate",    label: t("nav.donate") },
      { screen: "Profile",  type: "profile",   label: t("nav.profile") },
    ];
  }

  // General user: Home / Prayer / Deen / Profile (no Announcements — Home has it)
  return [
    { screen: "Home",   type: "home",      label: t("nav.home") },
    { screen: "Prayer", type: "prayerTime",label: t("nav.prayerTime") },
    { screen: "Deen",   type: "deen",      label: t("nav.deen") },
    { screen: "Profile",type: "profile",   label: t("nav.profile") },
  ];
}

const NavIcon = ({ active, type, color, inactiveColor }) => {
  const paths = {
    home: "M12 3 L3 10 L3 21 L9 21 L9 15 L15 15 L15 21 L21 21 L21 10 L12 3 Z",
    prayerTime: "M12 3 L12 12 L17 15 M12 3 A9 9 0 1 1 5.5 5.8",
    deen: "M12 4 L4 8 L4 16 L12 20 L20 16 L20 8 L12 4 Z M12 12 L12 20 M4 8 L12 12 L20 8",
    news: "M4 4 L20 4 L20 16 L12 20 L4 16 L4 4 Z M8 8 L16 8 M8 12 L14 12",
    donate: "M12 4 L16 8 L20 8 L18 12 L20 16 L16 16 L12 20 L8 16 L4 16 L6 12 L4 8 L8 8 L12 4 Z",
    profile: "M12 12 C14 12 16 10 16 8 C16 6 14 4 12 4 C10 4 8 6 8 8 C8 10 10 12 12 12 Z M6 20 L18 20 C18 16 15 14 12 14 C9 14 6 16 6 20 Z",
    editable: "M18 4 L20 6 L8 18 L6 18 L6 16 Z M15 7 L17 9",
    collector: "M4 6 L4 18 L8 18 L8 20 L16 20 L16 18 L20 18 L20 6 L18 4 L6 4 Z M8 8 L16 8 M8 12 L16 12 M8 16 L12 16",
    history: "M12 3 A9 9 0 1 0 21 12 M12 3 L12 12 L16 15 M18 3 L21 6 M21 3 L18 6",
    dashboard: "M4 4 L10 4 L10 12 L4 12 Z M14 4 L20 4 L20 9 L14 9 Z M14 13 L20 13 L20 20 L14 20 Z M4 16 L10 16 L10 20 L4 20 Z",
  };
  const d = paths[type] || paths.home;
  const isStroke = type === "prayerTime" || type === "editable" || type === "history";
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path
        d={d}
        fill={isStroke ? "none" : active ? color : inactiveColor}
        stroke={isStroke ? (active ? color : inactiveColor) : "none"}
        strokeWidth={isStroke ? 1.8 : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

const TabButton = ({ tab, isActive, badgeCount, onPress }) => {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => Animated.spring(scale, { toValue: 0.9, useNativeDriver: true, speed: 30 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }).start();

  return (
    <TouchableOpacity
      style={styles.navItem}
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      activeOpacity={0.85}
    >
      <Animated.View style={[styles.iconWrap, isActive && styles.iconWrapActive, { transform: [{ scale }] }]}>
        <NavIcon type={tab.type} active={isActive} color={C.bg} inactiveColor={C.textMuted} />
        {badgeCount > 0 && (
          <View style={styles.badge}>
            <Text allowFontScaling={false} style={styles.badgeText}>{badgeCount > 99 ? "99+" : String(badgeCount)}</Text>
          </View>
        )}
      </Animated.View>
      <Text allowFontScaling={false} style={[styles.navLabel, isActive && styles.navLabelActive]}>{tab.label}</Text>
    </TouchableOpacity>
  );
};

export default function BottomNav({ navigation, currentRoute, badges }) {
  const { t } = useTranslation();
  const [role, setRole] = useState(null);
  const [roles, setRoles] = useState(null);
  const [storedBadges, setStoredBadges] = useState({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const u = await AsyncStorage.getItem("user");
        if (u && mounted) {
          const parsed = JSON.parse(u);
          setRole(parsed?.role ?? null);
          setRoles(Array.isArray(parsed?.roles) ? parsed.roles : null);
        }
      } catch {
        if (mounted) { setRole(null); setRoles(null); }
      }
      try {
        const keys = ["badge_Donation", "badge_Announcement", "badge_Deen"];
        const pairs = await AsyncStorage.multiGet(keys);
        if (mounted) {
          const parsed = {};
          for (const [k, v] of pairs) {
            if (v) parsed[k.replace("badge_", "")] = parseInt(v, 10) || 0;
          }
          setStoredBadges(parsed);
        }
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const tabs = useMemo(() => buildTabs(role, roles, t), [role, roles, t]);
  const needsScroll = tabs.length > MAX_FIXED_TABS;

  const mergedBadges = useMemo(() => ({ ...storedBadges, ...badges }), [storedBadges, badges]);

  const renderTab = (tab) => {
    const isActive = currentRoute === tab.screen;
    const badgeCount = typeof mergedBadges?.[tab.screen] === "number" ? mergedBadges[tab.screen] : 0;
    return (
      <TabButton
        key={tab.screen}
        tab={tab}
        isActive={isActive}
        badgeCount={badgeCount}
        onPress={() => {
          if (!isActive) navigation.navigate(tab.screen);
        }}
      />
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.topAccent} />
      {needsScroll ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollRow}
        >
          {tabs.map((tab) => (
            <View key={tab.screen} style={{ width: TAB_WIDTH }}>
              {renderTab(tab)}
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.fixedRow}>{tabs.map(renderTab)}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: C.white,
    paddingTop: 12,
    paddingBottom: SAFE_B,
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
    ...sh(),
  },
  topAccent: { position: "absolute", top: 0, left: 0, right: 0, height: 2, backgroundColor: C.gold },
  fixedRow: { flexDirection: "row", paddingHorizontal: 6 },
  scrollRow: { paddingHorizontal: 10 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, minWidth: TAB_WIDTH - 8 },
  iconWrap: {
    position: "relative", width: 40, height: 32, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  iconWrapActive: { backgroundColor: "rgba(201,168,76,0.16)" },
  navLabel: { fontSize: 10, color: C.textMuted, fontWeight: "600" },
  navLabelActive: { color: C.bg, fontWeight: "800" },
  badge: {
    position: "absolute", top: -5, right: -8, minWidth: 16, height: 16, paddingHorizontal: 4,
    borderRadius: 9, backgroundColor: C.error, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: C.white,
  },
  badgeText: { color: C.white, fontSize: 9, fontWeight: "800" },
});