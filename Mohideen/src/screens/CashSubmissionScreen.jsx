// screens/CashSubmissionScreen.jsx
import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Alert, ActivityIndicator, SafeAreaView, StatusBar,
  Modal, FlatList,
} from "react-native";
import { useTranslation } from "react-i18next";
import { authApiFetch } from "../config/server";
import { colors } from "../config/theme";

// Pure-JS date picker — avoids @react-native-community/datetimepicker native module
function DatePickerModal({ visible, value, onConfirm, onCancel }) {
  const pad = (n) => String(n).padStart(2, "0");
  const [day,   setDay]   = useState(String(value.getDate()));
  const [month, setMonth] = useState(String(value.getMonth() + 1));
  const [year,  setYear]  = useState(String(value.getFullYear()));

  // Sync fields when `value` prop changes (e.g. resetting)
  React.useEffect(() => {
    setDay(String(value.getDate()));
    setMonth(String(value.getMonth() + 1));
    setYear(String(value.getFullYear()));
  }, [value]);

  const confirm = () => {
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (!d || !m || !y || m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) {
      Alert.alert("Invalid date", "Please enter a valid day, month, and year.");
      return;
    }
    onConfirm(new Date(y, m - 1, d));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity style={dpStyles.overlay} activeOpacity={1} onPress={onCancel}>
        <TouchableOpacity activeOpacity={1} style={dpStyles.card}>
          <Text style={dpStyles.title}>Select Date</Text>
          <View style={dpStyles.row}>
            <View style={dpStyles.field}>
              <Text style={dpStyles.label}>DD</Text>
              <TextInput style={dpStyles.input} value={day} onChangeText={setDay}
                keyboardType="numeric" maxLength={2} selectTextOnFocus />
            </View>
            <Text style={dpStyles.sep}>/</Text>
            <View style={dpStyles.field}>
              <Text style={dpStyles.label}>MM</Text>
              <TextInput style={dpStyles.input} value={month} onChangeText={setMonth}
                keyboardType="numeric" maxLength={2} selectTextOnFocus />
            </View>
            <Text style={dpStyles.sep}>/</Text>
            <View style={[dpStyles.field, { flex: 1.4 }]}>
              <Text style={dpStyles.label}>YYYY</Text>
              <TextInput style={dpStyles.input} value={year} onChangeText={setYear}
                keyboardType="numeric" maxLength={4} selectTextOnFocus />
            </View>
          </View>
          <View style={dpStyles.btnRow}>
            <TouchableOpacity style={dpStyles.cancelBtn} onPress={onCancel}>
              <Text style={dpStyles.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dpStyles.confirmBtn} onPress={confirm}>
              <Text style={dpStyles.confirmTxt}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const dpStyles = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", paddingHorizontal: 32 },
  card:       { backgroundColor: "#fff", borderRadius: 16, padding: 24 },
  title:      { fontSize: 16, fontWeight: "700", color: "#1A2E22", marginBottom: 16, textAlign: "center" },
  row:        { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 6, marginBottom: 20 },
  field:      { flex: 1, alignItems: "center" },
  label:      { fontSize: 11, color: "#5A7B65", fontWeight: "600", marginBottom: 4, letterSpacing: 0.5 },
  input:      { borderWidth: 1.5, borderColor: "#D6E8DC", borderRadius: 8, paddingVertical: 10,
                paddingHorizontal: 8, fontSize: 18, fontWeight: "700", color: "#1A2E22",
                textAlign: "center", width: "100%" },
  sep:        { fontSize: 22, color: "#5A7B65", fontWeight: "700", paddingBottom: 6 },
  btnRow:     { flexDirection: "row", gap: 12 },
  cancelBtn:  { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: "#D6E8DC", alignItems: "center" },
  cancelTxt:  { color: "#5A7B65", fontWeight: "600", fontSize: 14 },
  confirmBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: "#1A6B3A", alignItems: "center" },
  confirmTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
});

const fmt = (d) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";

export default function CashSubmissionScreen({ navigation }) {
  const { t } = useTranslation();

  const [startDate, setStartDate]     = useState(new Date());
  const [endDate, setEndDate]         = useState(new Date());
  const [amount, setAmount]           = useState("");
  const [notes, setNotes]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [showStart, setShowStart]     = useState(false);
  const [showEnd, setShowEnd]         = useState(false);

  // Admin dropdown
  const [admins, setAdmins]           = useState([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [selectedAdmin, setSelectedAdmin] = useState(null); // { id, name }
  const [showAdminPicker, setShowAdminPicker] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await authApiFetch("/collector/admins");
        if (!res.ok) return;
        const data = await res.json();
        setAdmins(Array.isArray(data) ? data : []);
      } catch {}
      finally { setAdminsLoading(false); }
    })();
  }, []);

  const submit = useCallback(async () => {
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      Alert.alert(t("cashSubmission.error"), t("cashSubmission.invalidAmount"));
      return;
    }
    if (endDate < startDate) {
      Alert.alert(t("cashSubmission.error"), t("cashSubmission.dateError"));
      return;
    }
    setLoading(true);
    try {
      const res = await authApiFetch("/collector/cash-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          submitted_amount: parseFloat(amount),
          notes: notes.trim() || null,
          receiving_admin_id: selectedAdmin?.id ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail || t("common.error"));
      }
      Alert.alert(
        t("cashSubmission.success"),
        t("cashSubmission.successMsg"),
        [{ text: "OK", onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      Alert.alert(t("cashSubmission.error"), err?.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, amount, notes, selectedAdmin, navigation, t]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0D2B1A" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backTxt}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("cashSubmission.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">

        {/* ── Submitted To ─────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Submitted To</Text>
        <TouchableOpacity
          style={styles.dropdownBtn}
          onPress={() => setShowAdminPicker(true)}
          disabled={adminsLoading}
          activeOpacity={0.8}
        >
          {adminsLoading ? (
            <ActivityIndicator size="small" color="#1A6B3A" />
          ) : (
            <>
              <Text style={[styles.dropdownVal, !selectedAdmin && styles.dropdownPlaceholder]}>
                {selectedAdmin ? selectedAdmin.name : "Select admin…"}
              </Text>
              <Text style={styles.dropdownChevron}>▼</Text>
            </>
          )}
        </TouchableOpacity>

        {/* ── Period ───────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("cashSubmission.period")}</Text>

        <TouchableOpacity style={styles.dateRow} onPress={() => setShowStart(true)}>
          <Text style={styles.dateLabel}>{t("cashSubmission.startDate")}</Text>
          <Text style={styles.dateValue}>{fmt(startDate)}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.dateRow} onPress={() => setShowEnd(true)}>
          <Text style={styles.dateLabel}>{t("cashSubmission.endDate")}</Text>
          <Text style={styles.dateValue}>{fmt(endDate)}</Text>
        </TouchableOpacity>

        <DatePickerModal
          visible={showStart}
          value={startDate}
          onConfirm={(d) => { setStartDate(d); setShowStart(false); }}
          onCancel={() => setShowStart(false)}
        />
        <DatePickerModal
          visible={showEnd}
          value={endDate}
          onConfirm={(d) => { setEndDate(d); setShowEnd(false); }}
          onCancel={() => setShowEnd(false)}
        />

        {/* ── Amount ───────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("cashSubmission.amountLabel")}</Text>
        <View style={styles.inputWrap}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0.00"
            placeholderTextColor="#aaa"
          />
        </View>

        {/* ── Notes ────────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("cashSubmission.notesLabel")}</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          placeholder={t("cashSubmission.notesPlaceholder")}
          placeholderTextColor="#aaa"
        />

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>{t("cashSubmission.lockWarning")}</Text>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitDisabled]}
          onPress={submit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitTxt}>{t("cashSubmission.submit")}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* ── Admin picker modal ────────────────────────────────────────── */}
      <Modal visible={showAdminPicker} transparent animationType="fade" onRequestClose={() => setShowAdminPicker(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAdminPicker(false)}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Admin</Text>
              <TouchableOpacity onPress={() => setShowAdminPicker(false)}>
                <Text style={{ fontSize: 18, color: "#5A7B65" }}>✕</Text>
              </TouchableOpacity>
            </View>
            {admins.length === 0 ? (
              <View style={{ padding: 24, alignItems: "center" }}>
                <Text style={{ color: "#5A7B65", fontSize: 14 }}>No admins found</Text>
              </View>
            ) : (
              <FlatList
                data={admins}
                keyExtractor={(a) => String(a.id)}
                style={{ maxHeight: 340 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.adminRow, selectedAdmin?.id === item.id && styles.adminRowActive]}
                    onPress={() => { setSelectedAdmin(item); setShowAdminPicker(false); }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.adminRowTxt, selectedAdmin?.id === item.id && styles.adminRowTxtActive]}>
                      {item.name}
                    </Text>
                    {selectedAdmin?.id === item.id && (
                      <Text style={{ color: "#1A6B3A", fontSize: 16 }}>✓</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#F4F8F5" },
  header:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    backgroundColor: "#0D2B1A", paddingHorizontal: 16, paddingVertical: 14 },
  back:           { width: 40, alignItems: "flex-start" },
  backTxt:        { fontSize: 22, color: "#fff" },
  headerTitle:    { fontSize: 17, fontWeight: "700", color: "#fff" },
  body:           { flex: 1, padding: 20 },
  sectionLabel:   { fontSize: 12, fontWeight: "700", color: "#5A7B65", textTransform: "uppercase",
                    letterSpacing: 0.8, marginTop: 20, marginBottom: 8 },
  dateRow:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    backgroundColor: "#fff", borderRadius: 8, padding: 14,
                    borderWidth: 1, borderColor: "#D6E8DC", marginBottom: 8 },
  dateLabel:      { fontSize: 14, color: "#1A2E22" },
  dateValue:      { fontSize: 14, fontWeight: "600", color: "#1A6B3A" },
  inputWrap:      { flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
                    borderRadius: 8, borderWidth: 1, borderColor: "#D6E8DC",
                    paddingHorizontal: 12 },
  rupee:          { fontSize: 18, color: "#1A6B3A", marginRight: 6 },
  input:          { flex: 1, fontSize: 18, color: "#1A2E22", paddingVertical: 12 },
  notesInput:     { backgroundColor: "#fff", borderRadius: 8, borderWidth: 1,
                    borderColor: "#D6E8DC", padding: 12, fontSize: 14,
                    color: "#1A2E22", minHeight: 80, textAlignVertical: "top" },
  infoBox:        { backgroundColor: "#FEF9C3", borderRadius: 8, padding: 12, marginTop: 16,
                    borderLeftWidth: 3, borderLeftColor: "#F59E0B" },
  infoText:       { fontSize: 13, color: "#854D0E", lineHeight: 18 },
  submitBtn:      { backgroundColor: "#1A6B3A", borderRadius: 10, padding: 16,
                    alignItems: "center", marginTop: 24, marginBottom: 40 },
  submitDisabled: { opacity: 0.6 },
  submitTxt:      { color: "#fff", fontSize: 16, fontWeight: "700" },

  // Dropdown
  dropdownBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#D6E8DC",
                    paddingHorizontal: 14, paddingVertical: 14, minHeight: 50 },
  dropdownVal:    { fontSize: 14, fontWeight: "600", color: "#1A2E22", flex: 1 },
  dropdownPlaceholder: { color: "#aaa", fontWeight: "400" },
  dropdownChevron:{ fontSize: 11, color: "#5A7B65", marginLeft: 8 },

  // Modal
  modalOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center",
                    paddingHorizontal: 24 },
  modalCard:      { backgroundColor: "#fff", borderRadius: 16, overflow: "hidden" },
  modalHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    paddingHorizontal: 18, paddingVertical: 14,
                    borderBottomWidth: 1, borderBottomColor: "#D6E8DC" },
  modalTitle:     { fontSize: 15, fontWeight: "800", color: "#1A2E22" },
  adminRow:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingHorizontal: 18, paddingVertical: 14,
                    borderBottomWidth: 1, borderBottomColor: "#F0F5F1" },
  adminRowActive: { backgroundColor: "rgba(26,107,58,0.06)" },
  adminRowTxt:    { fontSize: 14, color: "#1A2E22", flex: 1 },
  adminRowTxtActive: { fontWeight: "700", color: "#1A6B3A" },
});
