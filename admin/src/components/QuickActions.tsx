import {
  CalendarPlus,
  UserPlus,
  Send,
  FileSpreadsheet,
  FileText,
  BarChart3,
} from "lucide-react";

import COLORS from "../theme/colors";

interface Props {
  onGenerateMonth: () => void;
  onAddFamily: () => void;
  onSendSMS: () => void;
  onExportExcel: () => void;
  onExportPDF: () => void;
  onAnalytics: () => void;
}

export default function QuickActions({
  onGenerateMonth,
  onAddFamily,
  onSendSMS,
  onExportExcel,
  onExportPDF,
  onAnalytics,
}: Props) {
  const actions = [
    {
      title: "Generate Month",
      icon: CalendarPlus,
      color: COLORS.primary,
      background: COLORS.primaryLight,
      onClick: onGenerateMonth,
    },
    {
      title: "Add Family",
      icon: UserPlus,
      color: COLORS.lapis,
      background: COLORS.lapisLight,
      onClick: onAddFamily,
    },
    {
      title: "SMS Reminder",
      icon: Send,
      color: COLORS.warning,
      background: COLORS.warningLight,
      onClick: onSendSMS,
    },
    {
      title: "Excel",
      icon: FileSpreadsheet,
      color: COLORS.success,
      background: COLORS.successLight,
      onClick: onExportExcel,
    },
    {
      title: "PDF",
      icon: FileText,
      color: COLORS.danger,
      background: COLORS.dangerLight,
      onClick: onExportPDF,
    },
    {
      title: "Analytics",
      icon: BarChart3,
      color: COLORS.accent,
      background: COLORS.accentLight,
      onClick: onAnalytics,
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
        gap: 18,
        marginBottom: 28,
      }}
    >
      {actions.map((action) => {
        const Icon = action.icon;

        return (
          <button
            key={action.title}
            onClick={action.onClick}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 16,
              padding: 22,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              boxShadow: COLORS.shadowSm,
              transition: "0.25s",
            }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                borderRadius: 14,
                background: action.background,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Icon size={26} color={action.color} />
            </div>

            <span
              style={{
                color: COLORS.text,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {action.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}