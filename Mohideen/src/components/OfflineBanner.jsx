import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { formatLastUpdated } from "../utils/cache";

export default function OfflineBanner({ lastUpdated, onRetry }) {
  const { t } = useTranslation();
  return (
    <View style={s.wrap}>
      <Text style={s.text}>
        {t("common.offlineBanner")}
        {lastUpdated ? ` · ${t("common.lastUpdated")} ${formatLastUpdated(lastUpdated)}` : ""}
      </Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={s.retryBtn}>
          <Text style={s.retryText}>{t("common.retry")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: "#FFF8E7",
    borderBottomWidth: 1,
    borderBottomColor: "#E8D68A",
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  text: {
    fontSize: 12,
    color: "#7A5C00",
    fontWeight: "500",
    flex: 1,
  },
  retryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#E8D68A",
    marginLeft: 8,
  },
  retryText: {
    fontSize: 12,
    color: "#5A4300",
    fontWeight: "700",
  },
});
