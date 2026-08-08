// components/SearchPickerModal.jsx
// Zone/Street style "search + pick, or type a new one" modal shared by
// CollectorScreen (collections-list zone/street filter) and
// FamilySearchScreen (Add/Edit Family zone/street fields). Owns its own
// search-text state internally (memoized with React.memo) so typing in the
// search box only re-renders this small modal instead of the whole screen
// it's mounted in.
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, TextInput, FlatList, Modal, Pressable, StyleSheet } from "react-native";
import AnimatedPressable from "./AnimatedPressable";
import { COLORS as C } from "../config/theme";
import SafeModal from "./SafeModal";

const H = {
  card: C.white,
  cardBorder: "rgba(11,61,46,0.08)",
  bg: "#FBF9F4",
  textDark: C.textDark,
  textMuted: C.textMuted,
  gold: C.gold,
  goldDeep: C.goldDeep,
};

const SearchPickerModal = React.memo(function SearchPickerModal({
  visible,
  title,
  showSearch = true,
  searchPlaceholder = "Search...",
  autoCapitalize = "none",
  options,
  currentValue,
  onSelect,
  onClose,
  allTopOption, // { label, active }
  allowCustom = false,
  emptyText = "Nothing to select yet",
  noMatchPrefix, // e.g. "No zones match" — shown with the query appended
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const handleSelect = useCallback((value) => {
    onSelect(value);
    setQuery("");
  }, [onSelect]);

  const trimmed = query.trim();
  const showCustomOption = allowCustom && trimmed !== "" && !options.some((o) => o.toLowerCase() === trimmed.toLowerCase());
  const showNoMatch = noMatchPrefix && trimmed !== "" && filtered.length === 0;
  const showEmpty = options.length === 0 && trimmed === "" && !allTopOption;

  return (
    <SafeModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text allowFontScaling={false} style={[styles.title, { marginBottom: showSearch ? 10 : 0 }]}>{title}</Text>
            {showSearch && (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={searchPlaceholder}
                placeholderTextColor={H.textMuted}
                autoCapitalize={autoCapitalize}
                style={styles.searchInput}
              />
            )}
          </View>
          <FlatList
            style={{ maxHeight: 340 }}
            keyboardShouldPersistTaps="handled"
            data={filtered}
            keyExtractor={(item) => item}
            initialNumToRender={20}
            windowSize={5}
            ListHeaderComponent={
              allTopOption && trimmed === "" ? (
                <AnimatedPressable
                  style={[styles.option, allTopOption.active && styles.optionActive]}
                  onPress={() => handleSelect("")}
                >
                  <Text allowFontScaling={false} style={[styles.optionTxt, allTopOption.active && styles.optionTxtActive]}>
                    {allTopOption.label}
                  </Text>
                  {allTopOption.active ? <Text allowFontScaling={false} style={styles.check}>✓</Text> : null}
                </AnimatedPressable>
              ) : null
            }
            renderItem={({ item }) => (
              <AnimatedPressable
                style={[styles.option, currentValue === item && styles.optionActive]}
                onPress={() => handleSelect(item)}
              >
                <Text allowFontScaling={false} style={[styles.optionTxt, currentValue === item && styles.optionTxtActive]}>{item}</Text>
                {currentValue === item ? <Text allowFontScaling={false} style={styles.check}>✓</Text> : null}
              </AnimatedPressable>
            )}
            ListFooterComponent={
              showCustomOption ? (
                <AnimatedPressable style={styles.option} onPress={() => handleSelect(trimmed)}>
                  <Text allowFontScaling={false} style={[styles.optionTxt, { fontStyle: "italic" }]}>Use "{trimmed}"</Text>
                </AnimatedPressable>
              ) : showNoMatch ? (
                <Text allowFontScaling={false} style={styles.emptyTxt}>
                  {noMatchPrefix} "{trimmed}"
                </Text>
              ) : showEmpty ? (
                <Text allowFontScaling={false} style={styles.emptyTxt}>
                  {emptyText}
                </Text>
              ) : null
            }
          />
        </Pressable>
      </Pressable>
    </SafeModal>
  );
});

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", paddingHorizontal: 24 },
  card: { backgroundColor: H.card, borderRadius: 18, overflow: "hidden", maxHeight: 460 },
  header: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  title: { fontSize: 14, fontWeight: "800", color: H.textDark },
  searchInput: {
    backgroundColor: H.bg, borderRadius: 10, borderWidth: 1, borderColor: H.cardBorder,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: H.textDark,
  },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: H.cardBorder },
  optionActive: { backgroundColor: "rgba(201,168,76,0.08)" },
  optionTxt: { fontSize: 14, color: H.textDark },
  optionTxtActive: { fontWeight: "700", color: H.goldDeep },
  check: { color: H.gold, fontSize: 14 },
  emptyTxt: { padding: 18, textAlign: "center", color: H.textMuted, fontSize: 12 },
});

export default SearchPickerModal;
