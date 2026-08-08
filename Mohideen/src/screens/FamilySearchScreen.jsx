/**
 * FamilySearchScreen.jsx — Mohideen Masjid
 * Family search/list + Add/Edit Family, split out of CollectorScreen.jsx.
 *
 * CollectorScreen used to render this "Families" tab inline, in the same
 * ~2900-line component as the Collections payment-collection flow. Every
 * hook and re-render for the family list, search box, and Add/Edit Family
 * forms lived in that same giant component tree, which is what made the
 * Zone/Street pickers (and the tab in general) feel sluggish. Reached via
 * navigation.navigate("FamilySearch") from CollectorScreen's tab bar — the
 * same pattern CollectorScreen already uses for "Cash History" → CashSubmission.
 */
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, TextInput, FlatList, ActivityIndicator, Alert, Modal, Pressable, KeyboardAvoidingView, Platform, ScrollView, RefreshControl, StatusBar, StyleSheet } from "react-native";
import AnimatedPressable from "../components/AnimatedPressable";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authApiFetch } from "../config/server";
import { COLORS as C } from "../config/theme";
import { t } from "../i18n";
import SearchPickerModal from "../components/SearchPickerModal";

const normalizeRole = (role) => (role || "").toString().trim().toLowerCase();
const SUPERADMIN_ROLES = ["superadmin", "super_admin", "super admin"];
const isSuperadmin = (role) => SUPERADMIN_ROLES.includes(normalizeRole(role));

const H = {
  bg: "#FBF9F4",
  card: "#FFFFFF",
  cardBorder: "rgba(11,61,46,0.08)",
  headerDeep: C.bg,
  gold: C.gold,
  goldDeep: C.goldDeep,
  textDark: C.textDark,
  textMuted: C.textMuted,
  green: C.bgVivid,
  amber: "#B8862E",
  warn: "#9A6B2E",
};

const getMonthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const getMemberStatus = (item, month) => {
  const col = item.collections?.find((c) => c.month === month) || item.collections?.[0];
  const total = Number(col?.amount_due || 0);
  const paid = Number(col?.total_paid || 0);
  const balance = Math.max(total - paid, 0);
  const status = balance === 0 && total > 0 ? "paid" : paid > 0 ? "partial" : "pending";
  return { status };
};

const EMPTY_FORM = { name: "", chanda_no: "", phone: "", monthly_amount: "", address: "", zone: "", street: "", registration_date: "" };

export default function FamilySearchScreen({ navigation }) {
  const [role, setRole] = useState(null);
  const selectedMonth = useMemo(() => getMonthKey(), []);

  const [members, setMembers] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [familySearch, setFamilySearch] = useState("");

  const [zones, setZones] = useState([]);
  const [allStreets, setAllStreets] = useState([]);

  const [showAddFamily, setShowAddFamily] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);

  const [showEditFamily, setShowEditFamily] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);

  const [zoneFieldModal, setZoneFieldModal] = useState(null); // 'add' | 'edit' | null
  const [streetFieldModal, setStreetFieldModal] = useState(null); // 'add' | 'edit' | null
  const [dueSinceModal, setDueSinceModal] = useState(null); // 'add' | 'edit' | null
  const [dueSinceDraft, setDueSinceDraft] = useState(new Date());

  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [deactivatePassword, setDeactivatePassword] = useState("");
  const [deactivateReason, setDeactivateReason] = useState("");
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [deactivateError, setDeactivateError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const u = await AsyncStorage.getItem("user");
        if (u) setRole(JSON.parse(u)?.role);
      } catch (e) {}
    })();
  }, []);

  const fetchMembers = useCallback(async (silent = false) => {
    if (!silent) setFetching(true);
    try {
      const res = await authApiFetch(`/chanda/members?month=${selectedMonth}&include_history=true`);
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : []);
    } catch (e) {
      // Families is a management screen, not the field-collection flow —
      // no offline cache/queue needed here, unlike CollectorScreen.
    } finally {
      setFetching(false);
    }
  }, [selectedMonth]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  useEffect(() => {
    (async () => {
      try {
        const res = await authApiFetch("/admin/zones");
        if (!res.ok) return;
        const data = await res.json();
        setZones(Array.isArray(data) ? data : []);
      } catch { /* non-critical */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await authApiFetch("/admin/streets");
        if (!res.ok) return;
        const data = await res.json();
        setAllStreets(Array.isArray(data) ? data : []);
      } catch { /* non-critical */ }
    })();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchMembers(true);
    } finally {
      setRefreshing(false);
    }
  }, [fetchMembers]);

  const goToHistory = useCallback((item) => {
    if (!item?.member?.id) return;
    navigation.navigate("FamilyHistory", { familyId: item.member.id, familyName: item.member.name });
  }, [navigation]);

  // Chanda numbers must be unique across all families — index the already-
  // loaded list so Add/Edit Family can reject a duplicate locally instead of
  // only finding out after a round trip to the server.
  const chandaNoIndex = useMemo(() => {
    const map = new Map();
    members.forEach((item) => {
      const fam = item.member;
      const cn = (fam?.chanda_no || "").trim().toUpperCase();
      if (cn) map.set(cn, fam.id);
    });
    return map;
  }, [members]);

  const isChandaNoTaken = useCallback((value, excludeId) => {
    const cn = (value || "").trim().toUpperCase();
    if (!cn) return false;
    const ownerId = chandaNoIndex.get(cn);
    return ownerId !== undefined && ownerId !== excludeId;
  }, [chandaNoIndex]);

  const openDueSince = useCallback((which) => {
    const src = which === "add" ? addForm.registration_date : editForm.registration_date;
    let d = new Date();
    if (src && /^\d{4}-(0[1-9]|1[0-2])$/.test(src)) {
      const [y, m] = src.split("-").map(Number);
      d = new Date(y, m - 1, 1);
    }
    setDueSinceDraft(d);
    setDueSinceModal(which);
  }, [addForm.registration_date, editForm.registration_date]);

  const addFamily = useCallback(async () => {
    const amt = parseFloat(addForm.monthly_amount);
    if (!addForm.name.trim() || isNaN(amt) || amt <= 0) {
      return Alert.alert("Required fields missing", "Name and Monthly Amount are required.");
    }
    if (isChandaNoTaken(addForm.chanda_no)) {
      return Alert.alert("Chanda number in use", `Chanda number "${addForm.chanda_no.trim()}" is already assigned to another family.`);
    }
    const dueSince = addForm.registration_date.trim();
    if (dueSince && !/^\d{4}-(0[1-9]|1[0-2])$/.test(dueSince)) {
      return Alert.alert("Invalid month", "Chanda Due Since must be in YYYY-MM format, e.g. 2026-01.");
    }
    setAddSaving(true);
    try {
      const res = await authApiFetch("/collector/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          chanda_no: addForm.chanda_no.trim(),
          phone: addForm.phone.trim() || null,
          monthly_amount: amt,
          address: addForm.address.trim() || null,
          zone: addForm.zone.trim() || null,
          street: addForm.street.trim() || null,
          registration_date: dueSince ? `${dueSince}-01` : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || "Failed to add family");
      setShowAddFamily(false);
      setAddForm(EMPTY_FORM);
      fetchMembers(true);
      const assignedNo = body?.family?.chanda_no;
      Alert.alert(
        "Family Added",
        assignedNo
          ? `${addForm.name.trim()} has been added with Chanda No ${assignedNo}.`
          : `${addForm.name.trim()} has been added.`
      );
    } catch (err) {
      Alert.alert("Error", err.message || "Failed to add family");
    } finally {
      setAddSaving(false);
    }
  }, [addForm, fetchMembers, isChandaNoTaken]);

  const saveEditFamily = useCallback(async () => {
    if (!editItem) return;
    if (editForm.chanda_no.trim() && isChandaNoTaken(editForm.chanda_no, editItem.id)) {
      return Alert.alert("Chanda number in use", `Chanda number "${editForm.chanda_no.trim()}" is already assigned to another family.`);
    }
    const dueSince = editForm.registration_date.trim();
    if (dueSince && !/^\d{4}-(0[1-9]|1[0-2])$/.test(dueSince)) {
      return Alert.alert("Invalid month", "Chanda Due Since must be in YYYY-MM format, e.g. 2026-01.");
    }
    setEditSaving(true);
    try {
      const payload = {};
      if (editForm.name.trim()) payload.name = editForm.name.trim();
      if (editForm.chanda_no.trim()) payload.chanda_no = editForm.chanda_no.trim();
      payload.phone = editForm.phone.trim() || null;
      payload.address = editForm.address.trim() || null;
      payload.zone = editForm.zone.trim() || null;
      payload.street = editForm.street.trim() || null;
      const amt = parseFloat(editForm.monthly_amount);
      if (!isNaN(amt) && amt > 0) payload.monthly_amount = amt;
      if (dueSince) payload.registration_date = `${dueSince}-01`;

      const res = await authApiFetch(`/collector/families/${editItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to update family");
      setShowEditFamily(false);
      setEditItem(null);
      fetchMembers(true);
    } catch (err) {
      Alert.alert("Error", err.message || "Failed to update family");
    } finally {
      setEditSaving(false);
    }
  }, [editItem, editForm, fetchMembers, isChandaNoTaken]);

  const confirmDeactivate = useCallback(async () => {
    if (!editItem) return;
    if (!deactivatePassword) {
      setDeactivateError("Enter your password to confirm.");
      return;
    }
    setDeactivateBusy(true);
    setDeactivateError("");
    try {
      const res = await authApiFetch(`/admin/families/${editItem.id}/deactivate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deactivatePassword, reason: deactivateReason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to deactivate family");
      setShowDeactivateConfirm(false);
      setShowEditFamily(false);
      setDeactivatePassword("");
      setDeactivateReason("");
      setEditItem(null);
      fetchMembers(true);
      Alert.alert("Deactivated", `${data.message || "Family deactivated."}`);
    } catch (err) {
      setDeactivateError(err.message || "Failed to deactivate family");
    } finally {
      setDeactivateBusy(false);
    }
  }, [editItem, deactivatePassword, deactivateReason, fetchMembers]);

  // Families search — matches name, address, chanda number, and phone.
  const filteredFamilies = useMemo(() => {
    const normalize = (s) => (s || "").toLowerCase().replace(/[-\s]+/g, "");
    const q = normalize(familySearch);
    if (!q) return members;
    return members.filter((m) => {
      const haystack = normalize(
        `${m.member?.name} ${m.member?.address} ${m.member?.chanda_no} ${m.member?.phone}`
      );
      return haystack.includes(q);
    });
  }, [members, familySearch]);

  return (
    <View style={s.root}>

      <View style={s.navBar}>
        <View style={s.navLeft}>
          <AnimatedPressable onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text allowFontScaling={false} style={s.backBtnTxt}>←</Text>
          </AnimatedPressable>
          <Text allowFontScaling={false} style={s.navTitle}>{t("collectorTabs.families")}</Text>
        </View>
      </View>

      <View style={s.familiesHeader}>
        <Text allowFontScaling={false} style={s.familiesCount}>
          {familySearch.trim() ? `${filteredFamilies.length} of ${members.length}` : members.length} {t("collector.families")}
        </Text>
        <AnimatedPressable
          style={s.addFamilyBtn}
          onPress={() => { setAddForm(EMPTY_FORM); setShowAddFamily(true); }}
          activeOpacity={0.85}
        >
          <Text allowFontScaling={false} style={s.addFamilyTxt}>+ Add Family</Text>
        </AnimatedPressable>
      </View>

      <View style={s.familySearchBox}>
        <TextInput
          placeholder="Search by name, address, chanda no, or phone"
          placeholderTextColor={H.textMuted}
          value={familySearch}
          onChangeText={setFamilySearch}
          style={s.familySearchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {familySearch.length > 0 && (
          <AnimatedPressable onPress={() => setFamilySearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text allowFontScaling={false} style={s.clearTxt}>{t("collector.clear")}</Text>
          </AnimatedPressable>
        )}
      </View>

      <FlatList
        data={filteredFamilies}
        keyExtractor={(item) => String(item.member.id)}
        contentContainerStyle={s.tabContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={H.gold} colors={[H.gold]} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text allowFontScaling={false} style={s.emptyTxt}>
              {fetching ? t("collector.loading") : familySearch.trim() ? "No families match your search" : t("collector.noFamilies")}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const fam = item.member;
          const { status } = getMemberStatus(item, selectedMonth);
          const sColor = status === "paid" ? H.green : status === "partial" ? H.amber : H.warn;
          return (
            <View style={[s.famCard, { borderLeftWidth: 3, borderLeftColor: sColor }]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  {fam.chanda_no ? (
                    <Text allowFontScaling={false} style={s.famChanda}>{fam.chanda_no}</Text>
                  ) : null}
                  <Text allowFontScaling={false} style={s.famName} numberOfLines={1}>{fam.name}</Text>
                </View>
                <Text allowFontScaling={false} style={s.famMeta}>
                  {fam.phone || t("collectorTabs.noPhone")} · ₹{fam.monthly_amount ?? "—"}
                </Text>
                {fam.address ? (
                  <Text allowFontScaling={false} style={[s.famMeta, { marginTop: 1 }]} numberOfLines={1}>{fam.address}</Text>
                ) : null}
                {fam.zone ? (
                  <Text allowFontScaling={false} style={s.famZone}>{fam.zone}</Text>
                ) : null}
              </View>
              <View style={{ gap: 6, alignItems: "flex-end" }}>
                <AnimatedPressable
                  style={s.famEditBtn}
                  onPress={() => {
                    setEditItem(fam);
                    setEditForm({
                      name: fam.name || "",
                      chanda_no: fam.chanda_no || "",
                      phone: fam.phone || "",
                      monthly_amount: String(fam.monthly_amount ?? ""),
                      address: fam.address || "",
                      zone: fam.zone || "",
                      street: fam.street || "",
                      registration_date: fam.registration_date ? fam.registration_date.slice(0, 7) : "",
                    });
                    setShowEditFamily(true);
                  }}
                  activeOpacity={0.85}
                >
                  <Text allowFontScaling={false} style={s.famEditTxt}>Edit</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  style={[s.famEditBtn, { backgroundColor: "transparent", borderColor: H.cardBorder }]}
                  onPress={() => goToHistory(item)}
                  activeOpacity={0.85}
                >
                  <Text allowFontScaling={false} style={[s.famEditTxt, { color: H.textMuted }]}>History</Text>
                </AnimatedPressable>
                {isSuperadmin(role) && fam.is_active !== false && (
                  <AnimatedPressable
                    style={[s.famEditBtn, { backgroundColor: "#F8E9E9", borderColor: "#E8BBBB" }]}
                    onPress={() => {
                      setEditItem(fam);
                      setDeactivateError("");
                      setDeactivatePassword("");
                      setDeactivateReason("");
                      setShowDeactivateConfirm(true);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text allowFontScaling={false} style={[s.famEditTxt, { color: "#A13A3A" }]}>Deactivate</Text>
                  </AnimatedPressable>
                )}
              </View>
            </View>
          );
        }}
      />

      {/* ── Add Family modal ─────────────────────────────────────────────── */}
      <Modal visible={showAddFamily} transparent animationType="slide" onRequestClose={() => setShowAddFamily(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.overlay} onPress={() => setShowAddFamily(false)}>
            <View style={[s.sheet, { height: "90%" }]} onStartShouldSetResponder={() => true}>
              <View style={s.handle} />
              <Text allowFontScaling={false} style={[s.sheetEye, { marginBottom: 2 }]}>NEW FAMILY</Text>
              <Text allowFontScaling={false} style={[s.sheetName, { marginBottom: 14 }]}>Add Family</Text>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
                {[
                  { label: "Family Name *", key: "name", placeholder: "Full name", keyboard: "default" },
                  { label: "Chanda Due Since", key: "registration_date", placeholder: "Select month", keyboard: "default" },
                  { label: "Chanda No", key: "chanda_no", placeholder: "Leave blank to auto-generate", keyboard: "default" },
                  { label: "Monthly Amount (₹) *", key: "monthly_amount", placeholder: "0", keyboard: "numeric" },
                  { label: "Phone", key: "phone", placeholder: "10-digit mobile", keyboard: "phone-pad" },
                  { label: "Address", key: "address", placeholder: "Area / landmark", keyboard: "default" },
                  { label: "Zone", key: "zone", placeholder: "Select or type a zone", keyboard: "default" },
                  { label: "Street", key: "street", placeholder: "Select or type a street", keyboard: "default" },
                ].map(({ label, key, placeholder, keyboard }) => (
                  <View key={key} style={{ marginBottom: 12 }}>
                    <Text allowFontScaling={false} style={s.secLabel}>{label}</Text>
                    {key === "zone" ? (
                      <AnimatedPressable
                        style={[s.refInput, { justifyContent: "center" }]}
                        onPress={() => setZoneFieldModal("add")}
                      >
                        <Text allowFontScaling={false} style={{ fontSize: 14, color: addForm.zone ? H.textDark : H.textMuted }}>
                          {addForm.zone || placeholder}
                        </Text>
                      </AnimatedPressable>
                    ) : key === "street" ? (
                      <AnimatedPressable
                        style={[s.refInput, { justifyContent: "center" }]}
                        onPress={() => setStreetFieldModal("add")}
                      >
                        <Text allowFontScaling={false} style={{ fontSize: 14, color: addForm.street ? H.textDark : H.textMuted }}>
                          {addForm.street || placeholder}
                        </Text>
                      </AnimatedPressable>
                    ) : key === "registration_date" ? (
                      <AnimatedPressable
                        style={[s.refInput, { justifyContent: "center" }]}
                        onPress={() => openDueSince("add")}
                      >
                        <Text allowFontScaling={false} style={{ fontSize: 14, color: addForm.registration_date ? H.textDark : H.textMuted }}>
                          {addForm.registration_date || placeholder}
                        </Text>
                      </AnimatedPressable>
                    ) : (
                      <TextInput
                        style={s.refInput}
                        value={addForm[key]}
                        onChangeText={(v) => setAddForm((f) => ({ ...f, [key]: v }))}
                        keyboardType={keyboard}
                        placeholder={placeholder}
                        placeholderTextColor={H.textMuted}
                        autoCapitalize={key === "name" || key === "address" ? "words" : "none"}
                      />
                    )}
                    {key === "chanda_no" && addForm.chanda_no.trim() !== "" && isChandaNoTaken(addForm.chanda_no) && (
                      <Text allowFontScaling={false} style={{ fontSize: 11, color: H.warn, marginTop: 4 }}>
                        This chanda number is already in use.
                      </Text>
                    )}
                    {key === "registration_date" && (
                      <Text allowFontScaling={false} style={{ fontSize: 11, color: H.textMuted, marginTop: 4 }}>
                        Pending chanda months will be generated from this month to now. Leave blank to start from this month only.
                      </Text>
                    )}
                  </View>
                ))}
                <AnimatedPressable
                  style={[s.submitBtn, addSaving && { opacity: 0.6 }, { marginTop: 8 }]}
                  onPress={addFamily}
                  disabled={addSaving}
                >
                  {addSaving
                    ? <ActivityIndicator color={H.headerDeep} />
                    : <Text allowFontScaling={false} style={s.submitBtnTxt}>Add Family</Text>
                  }
                </AnimatedPressable>
              </ScrollView>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Edit Family modal ────────────────────────────────────────────── */}
      <Modal visible={showEditFamily} transparent animationType="slide" onRequestClose={() => setShowEditFamily(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={s.overlay} onPress={() => setShowEditFamily(false)}>
            <View style={[s.sheet, { height: "90%" }]} onStartShouldSetResponder={() => true}>
              <View style={s.handle} />
              <Text allowFontScaling={false} style={[s.sheetEye, { marginBottom: 2 }]}>EDIT FAMILY</Text>
              <Text allowFontScaling={false} style={[s.sheetName, { marginBottom: 14 }]}>{editItem?.name || "Edit"}</Text>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
                {[
                  { label: "Family Name", key: "name", placeholder: "Full name", keyboard: "default" },
                  { label: "Chanda Due Since", key: "registration_date", placeholder: "Select month", keyboard: "default" },
                  { label: "Chanda No", key: "chanda_no", placeholder: "e.g. MM001", keyboard: "default" },
                  { label: "Monthly Amount (₹)", key: "monthly_amount", placeholder: "0", keyboard: "numeric" },
                  { label: "Phone", key: "phone", placeholder: "10-digit mobile", keyboard: "phone-pad" },
                  { label: "Address", key: "address", placeholder: "Area / landmark", keyboard: "default" },
                  { label: "Zone", key: "zone", placeholder: "Select or type a zone", keyboard: "default" },
                  { label: "Street", key: "street", placeholder: "Select or type a street", keyboard: "default" },
                ].map(({ label, key, placeholder, keyboard }) => (
                  <View key={key} style={{ marginBottom: 12 }}>
                    <Text allowFontScaling={false} style={s.secLabel}>{label}</Text>
                    {key === "zone" ? (
                      <AnimatedPressable
                        style={[s.refInput, { justifyContent: "center" }]}
                        onPress={() => setZoneFieldModal("edit")}
                      >
                        <Text allowFontScaling={false} style={{ fontSize: 14, color: editForm.zone ? H.textDark : H.textMuted }}>
                          {editForm.zone || placeholder}
                        </Text>
                      </AnimatedPressable>
                    ) : key === "street" ? (
                      <AnimatedPressable
                        style={[s.refInput, { justifyContent: "center" }]}
                        onPress={() => setStreetFieldModal("edit")}
                      >
                        <Text allowFontScaling={false} style={{ fontSize: 14, color: editForm.street ? H.textDark : H.textMuted }}>
                          {editForm.street || placeholder}
                        </Text>
                      </AnimatedPressable>
                    ) : key === "registration_date" ? (
                      <AnimatedPressable
                        style={[s.refInput, { justifyContent: "center" }]}
                        onPress={() => openDueSince("edit")}
                      >
                        <Text allowFontScaling={false} style={{ fontSize: 14, color: editForm.registration_date ? H.textDark : H.textMuted }}>
                          {editForm.registration_date || placeholder}
                        </Text>
                      </AnimatedPressable>
                    ) : (
                      <TextInput
                        style={s.refInput}
                        value={editForm[key]}
                        onChangeText={(v) => setEditForm((f) => ({ ...f, [key]: v }))}
                        keyboardType={keyboard}
                        placeholder={placeholder}
                        placeholderTextColor={H.textMuted}
                        autoCapitalize={key === "name" || key === "address" ? "words" : "none"}
                      />
                    )}
                    {key === "chanda_no" && editForm.chanda_no.trim() !== "" && isChandaNoTaken(editForm.chanda_no, editItem?.id) && (
                      <Text allowFontScaling={false} style={{ fontSize: 11, color: H.warn, marginTop: 4 }}>
                        This chanda number is already in use.
                      </Text>
                    )}
                    {key === "registration_date" && (
                      <Text allowFontScaling={false} style={{ fontSize: 11, color: H.textMuted, marginTop: 4 }}>
                        Changing this backfills any newly-covered pending months — existing collections are never removed or duplicated.
                      </Text>
                    )}
                  </View>
                ))}
                <AnimatedPressable
                  style={[s.submitBtn, editSaving && { opacity: 0.6 }, { marginTop: 8 }]}
                  onPress={saveEditFamily}
                  disabled={editSaving}
                >
                  {editSaving
                    ? <ActivityIndicator color={H.headerDeep} />
                    : <Text allowFontScaling={false} style={s.submitBtnTxt}>Save Changes</Text>
                  }
                </AnimatedPressable>
              </ScrollView>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Deactivate Member confirmation ──────────────────────────────── */}
      <Modal visible={showDeactivateConfirm} transparent animationType="fade" onRequestClose={() => setShowDeactivateConfirm(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", paddingHorizontal: 24 }} onPress={() => setShowDeactivateConfirm(false)}>
          <Pressable style={{ backgroundColor: H.card, borderRadius: 18, padding: 20 }} onPress={() => {}}>
            <Text allowFontScaling={false} style={{ fontSize: 16, fontWeight: "800", color: H.textDark, marginBottom: 4 }}>Deactivate Member</Text>
            <Text allowFontScaling={false} style={{ fontSize: 12, color: H.textMuted, marginBottom: 14 }}>
              {editItem?.name} will be hidden from active collection lists and can be restored within 30 days. Enter your password to confirm.
            </Text>
            <Text allowFontScaling={false} style={s.secLabel}>Your Password</Text>
            <TextInput
              style={s.refInput}
              value={deactivatePassword}
              onChangeText={setDeactivatePassword}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor={H.textMuted}
            />
            <Text allowFontScaling={false} style={[s.secLabel, { marginTop: 12 }]}>Reason (optional)</Text>
            <TextInput
              style={s.refInput}
              value={deactivateReason}
              onChangeText={setDeactivateReason}
              placeholder="e.g. Moved out of area"
              placeholderTextColor={H.textMuted}
            />
            {!!deactivateError && (
              <Text allowFontScaling={false} style={{ fontSize: 12, color: H.warn, marginTop: 8 }}>{deactivateError}</Text>
            )}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <AnimatedPressable
                style={[s.submitBtn, { flex: 1, backgroundColor: H.bg, borderWidth: 1, borderColor: H.cardBorder }]}
                onPress={() => setShowDeactivateConfirm(false)}
                disabled={deactivateBusy}
              >
                <Text allowFontScaling={false} style={[s.submitBtnTxt, { color: H.textDark }]}>Cancel</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={[s.submitBtn, { flex: 1, backgroundColor: "#A13A3A" }, deactivateBusy && { opacity: 0.6 }]}
                onPress={confirmDeactivate}
                disabled={deactivateBusy}
              >
                {deactivateBusy
                  ? <ActivityIndicator color="#fff" />
                  : <Text allowFontScaling={false} style={[s.submitBtnTxt, { color: "#fff" }]}>Confirm</Text>
                }
              </AnimatedPressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Zone dropdown for Add/Edit Family ───────────────────────────── */}
      <SearchPickerModal
        visible={!!zoneFieldModal}
        title="Select Zone"
        searchPlaceholder="Search or type a new zone..."
        autoCapitalize="words"
        options={zones}
        currentValue={zoneFieldModal === "add" ? addForm.zone : editForm.zone}
        allowCustom
        emptyText="No zones yet — type above to add one"
        onSelect={(v) => {
          if (zoneFieldModal === "add") setAddForm((f) => ({ ...f, zone: v }));
          else setEditForm((f) => ({ ...f, zone: v }));
          setZoneFieldModal(null);
        }}
        onClose={() => setZoneFieldModal(null)}
      />

      {/* ── Street dropdown for Add/Edit Family — same /admin/streets lookup,
          so Excel-imported sectors show up automatically. ─────────────── */}
      <SearchPickerModal
        visible={!!streetFieldModal}
        title="Select Street"
        searchPlaceholder="Search or type a new street..."
        autoCapitalize="words"
        options={allStreets}
        currentValue={streetFieldModal === "add" ? addForm.street : editForm.street}
        allowCustom
        emptyText="No streets yet — type above to add one"
        onSelect={(v) => {
          if (streetFieldModal === "add") setAddForm((f) => ({ ...f, street: v }));
          else setEditForm((f) => ({ ...f, street: v }));
          setStreetFieldModal(null);
        }}
        onClose={() => setStreetFieldModal(null)}
      />

      {/* ── Chanda Due Since month/year picker for Add/Edit Family ─────────
          Custom JS-only spinner modal, matching CollectorScreen's collected-
          date picker rather than the native DateTimePicker. */}
      <Modal visible={!!dueSinceModal} transparent animationType="fade" onRequestClose={() => setDueSinceModal(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" }}
          onPress={() => setDueSinceModal(null)}>
          <Pressable style={{
            backgroundColor: "#fff", borderRadius: 18, padding: 24,
            width: 280, alignItems: "center",
            shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, elevation: 10,
          }} onPress={() => {}}>
            <Text allowFontScaling={false} style={{ fontSize: 16, fontWeight: "700", color: "#1C231F", marginBottom: 20 }}>
              Chanda Due Since
            </Text>
            {(() => {
              const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              const mo = dueSinceDraft.getMonth();
              const y = dueSinceDraft.getFullYear();
              const today = new Date();
              const clamp = (d) => (d > today ? new Date(today.getFullYear(), today.getMonth(), 1) : d);
              const bump = (field, delta) => {
                const nd = new Date(dueSinceDraft);
                if (field === "m") nd.setMonth(mo + delta);
                else nd.setFullYear(y + delta);
                setDueSinceDraft(clamp(nd));
              };
              const SpinCol = ({ label, onUp, onDown }) => (
                <View style={{ alignItems: "center", flex: 1 }}>
                  <AnimatedPressable onPress={onUp} style={{ padding: 8 }}>
                    <Text allowFontScaling={false} style={{ fontSize: 22, color: "#0F5C4C", fontWeight: "700" }}>▲</Text>
                  </AnimatedPressable>
                  <Text allowFontScaling={false} style={{ fontSize: 20, fontWeight: "800", color: "#1C231F", minWidth: 76, textAlign: "center" }}>{label}</Text>
                  <AnimatedPressable onPress={onDown} style={{ padding: 8 }}>
                    <Text allowFontScaling={false} style={{ fontSize: 22, color: "#0F5C4C", fontWeight: "700" }}>▼</Text>
                  </AnimatedPressable>
                </View>
              );
              return (
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 20 }}>
                  <SpinCol label={months[mo]} onUp={() => bump("m", 1)} onDown={() => bump("m", -1)} />
                  <Text allowFontScaling={false} style={{ fontSize: 20, color: "#C8C0A8", marginHorizontal: 4 }}>/</Text>
                  <SpinCol label={String(y)} onUp={() => bump("y", 1)} onDown={() => bump("y", -1)} />
                </View>
              );
            })()}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <AnimatedPressable
                onPress={() => {
                  if (dueSinceModal === "add") setAddForm((f) => ({ ...f, registration_date: "" }));
                  else setEditForm((f) => ({ ...f, registration_date: "" }));
                  setDueSinceModal(null);
                }}
                style={{ borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: "#0F5C4C" }}
              >
                <Text allowFontScaling={false} style={{ color: "#0F5C4C", fontWeight: "700", fontSize: 14 }}>Clear</Text>
              </AnimatedPressable>
              <AnimatedPressable
                onPress={() => {
                  const val = `${dueSinceDraft.getFullYear()}-${String(dueSinceDraft.getMonth() + 1).padStart(2, "0")}`;
                  if (dueSinceModal === "add") setAddForm((f) => ({ ...f, registration_date: val }));
                  else setEditForm((f) => ({ ...f, registration_date: val }));
                  setDueSinceModal(null);
                }}
                style={{ backgroundColor: "#0F5C4C", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 }}
              >
                <Text allowFontScaling={false} style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Done</Text>
              </AnimatedPressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: H.bg },

  navBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 14 : 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: H.cardBorder, backgroundColor: H.bg },
  navLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  backBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: H.card, borderWidth: 1, borderColor: H.cardBorder, justifyContent: "center", alignItems: "center", marginRight: 10 },
  backBtnTxt: { color: H.textDark, fontSize: 14, fontWeight: "700" },
  navTitle: { color: H.textDark, fontSize: 17, fontWeight: "800" },

  familiesHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  familiesCount: { fontSize: 12, color: H.textMuted, fontWeight: "600" },
  addFamilyBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: H.gold, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  addFamilyTxt: { fontSize: 12, color: H.headerDeep, fontWeight: "800" },

  familySearchBox: { flexDirection: "row", alignItems: "center", backgroundColor: H.card, borderRadius: 11, borderWidth: 1, borderColor: H.cardBorder, paddingHorizontal: 12, marginHorizontal: 16, marginTop: 10, marginBottom: 10 },
  familySearchInput: { flex: 1, color: H.textDark, fontSize: 13, paddingVertical: Platform.OS === "android" ? 8 : 10 },
  clearTxt: { color: H.textMuted, fontSize: 12, paddingLeft: 8 },

  tabContent: { padding: 16, paddingBottom: 40 },
  empty: { alignItems: "center", paddingTop: 56 },
  emptyTxt: { color: H.textMuted, fontSize: 14 },

  famCard: { flexDirection: "row", alignItems: "center", backgroundColor: H.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: H.cardBorder },
  famName: { fontSize: 14, fontWeight: "700", color: H.textDark },
  famMeta: { fontSize: 12, color: H.textMuted, marginTop: 2 },
  famChanda: { fontSize: 11, color: H.gold, marginTop: 2, fontWeight: "700" },
  famZone: { fontSize: 10, color: H.gold, fontWeight: "700", backgroundColor: "rgba(201,168,76,0.1)", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start", marginTop: 4 },
  famEditBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "rgba(201,168,76,0.12)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(201,168,76,0.25)" },
  famEditTxt: { fontSize: 12, fontWeight: "700", color: H.gold },

  overlay: { flex: 1, backgroundColor: "rgba(11,61,46,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: H.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: H.cardBorder, borderBottomWidth: 0, height: "93%", paddingHorizontal: 18 },
  handle: { width: 34, height: 4, backgroundColor: H.textMuted, borderRadius: 99, opacity: 0.3, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  sheetEye: { color: H.gold, fontSize: 9, letterSpacing: 2, marginBottom: 5, fontWeight: "800" },
  sheetName: { color: H.textDark, fontSize: 17, fontWeight: "700" },
  secLabel: { color: H.textMuted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, fontWeight: "700" },
  refInput: { color: H.textDark, fontSize: 13, backgroundColor: H.card, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, marginTop: 4, borderWidth: 1, borderColor: H.cardBorder },
  submitBtn: { backgroundColor: H.gold, borderRadius: 13, paddingVertical: 16, alignItems: "center" },
  submitBtnTxt: { color: H.headerDeep, fontSize: 15, fontWeight: "800" },
});
