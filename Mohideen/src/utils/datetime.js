const parseServerDate = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().replace(" ", "T");
  if (/([zZ]|[+-]\d{2}:\d{2})$/.test(normalized)) {
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const clean = normalized.split(".")[0];
  const parts = clean.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!parts) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(
    Date.UTC(
      Number(parts[1]),
      Number(parts[2]) - 1,
      Number(parts[3]),
      Number(parts[4]),
      Number(parts[5]),
      Number(parts[6] || 0)
    )
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatServerDateTime = (value) => {
  const parsed = parseServerDate(value);
  if (!parsed) {
    return "N/A";
  }

  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

export const formatCoveredMonths = (months = []) => {
  if (!Array.isArray(months) || months.length === 0) {
    return "N/A";
  }

  return months
    .map((monthKey) => {
      const [year, month] = String(monthKey).split("-").map(Number);
      if (!year || !month) {
        return monthKey;
      }
      return new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
      });
    })
    .join(", ");
};
