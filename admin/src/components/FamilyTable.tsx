import {
  Eye,
  Edit,
  MessageSquare,
  Receipt,
} from "lucide-react";

import COLORS from "../theme/colors";

export interface FamilyRow {
  id: number;

  chandaNo: string;

  headName: string;

  phone: string;

  monthlyAmount: number;

  currentStatus: "paid" | "partial" | "pending";

  pendingMonths: number;

  lastPayment: string;

  collector: string;
}

interface Props {
  rows: FamilyRow[];

  onView(id: number): void;

  onEdit(id: number): void;

  onSMS(id: number): void;

  onStatement(id: number): void;
}

export default function FamilyTable({
  rows,
  onView,
  onEdit,
  onSMS,
  onStatement,
}: Props) {
  const badge = (status: FamilyRow["currentStatus"]) => {
    switch (status) {
      case "paid":
        return {
          bg: COLORS.successLight,
          color: COLORS.success,
          text: "Paid",
        };

      case "partial":
        return {
          bg: COLORS.warningLight,
          color: COLORS.warning,
          text: "Partial",
        };

      default:
        return {
          bg: COLORS.dangerLight,
          color: COLORS.danger,
          text: "Pending",
        };
    }
  };

  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: COLORS.shadowSm,
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
        }}
      >
        <thead
          style={{
            background: COLORS.tableHeader,
          }}
        >
          <tr>
            {[
              "Chanda No",
              "Head",
              "Phone",
              "Monthly",
              "Status",
              "Pending",
              "Last Paid",
              "Collector",
              "Actions",
            ].map((h) => (
              <th
                key={h}
                style={{
                  padding: "16px",
                  textAlign: "left",
                  color: COLORS.tableHeaderText,
                  fontWeight: 600,
                  fontSize: 14,
                  borderBottom: `1px solid ${COLORS.tableBorder}`,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((family) => {
            const status = badge(family.currentStatus);

            return (
              <tr
                key={family.id}
                style={{
                  borderBottom: `1px solid ${COLORS.tableBorder}`,
                }}
              >
                <td style={cell}>
                  {family.chandaNo}
                </td>

                <td style={cell}>
                  <strong>{family.headName}</strong>
                </td>

                <td style={cell}>
                  {family.phone}
                </td>

                <td style={cell}>
                  ₹{family.monthlyAmount.toLocaleString()}
                </td>

                <td style={cell}>
                  <span
                    style={{
                      background: status.bg,
                      color: status.color,
                      padding: "6px 12px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {status.text}
                  </span>
                </td>

                <td style={cell}>
                  {family.pendingMonths} month(s)
                </td>

                <td style={cell}>
                  {family.lastPayment}
                </td>

                <td style={cell}>
                  {family.collector}
                </td>

                <td style={cell}>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                    }}
                  >
                    <button
                      onClick={() =>
                        onView(family.id)
                      }
                    >
                      <Eye
                        size={18}
                        color={COLORS.lapis}
                      />
                    </button>

                    <button
                      onClick={() =>
                        onEdit(family.id)
                      }
                    >
                      <Edit
                        size={18}
                        color={COLORS.primary}
                      />
                    </button>

                    <button
                      onClick={() =>
                        onSMS(family.id)
                      }
                    >
                      <MessageSquare
                        size={18}
                        color={COLORS.warning}
                      />
                    </button>

                    <button
                      onClick={() =>
                        onStatement(family.id)
                      }
                    >
                      <Receipt
                        size={18}
                        color={COLORS.accent}
                      />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "16px",
  fontSize: 14,
  color: COLORS.text,
};