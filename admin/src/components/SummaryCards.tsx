import {
  Users,
  Wallet,
  IndianRupee,
  TrendingUp,
  AlertTriangle,
  CircleDollarSign,
} from "lucide-react";

import COLORS from "../theme/colors";

export interface SummaryData {
  totalFamilies: number;
  expectedAmount: number;
  collectedAmount: number;
  outstandingAmount: number;
  collectionPercentage: number;
  defaulters: number;
}

interface Props {
  data: SummaryData;
}

export default function SummaryCards({ data }: Props) {
  const cards = [
    {
      title: "Families",
      value: data.totalFamilies,
      icon: Users,
      bg: COLORS.primaryLight,
      color: COLORS.primary,
    },
    {
      title: "Expected",
      value: `₹${(data.expectedAmount ?? 0).toLocaleString()}`,
      icon: Wallet,
      bg: COLORS.accentLight,
      color: COLORS.accent,
    },
    {
      title: "Collected",
      value: `₹${(data.collectedAmount ?? 0).toLocaleString()}`,
      icon: IndianRupee,
      bg: COLORS.infoLight,
      color: COLORS.info,
    },
    {
      title: "Outstanding",
      value: `₹${(data.outstandingAmount ?? 0).toLocaleString()}`,
      icon: CircleDollarSign,
      bg: COLORS.dangerLight,
      color: COLORS.danger,
    },
    {
      title: "Collection %",
      value: `${data.collectionPercentage ?? 0}%`,
      icon: TrendingUp,
      bg: COLORS.primaryLight,
      color: COLORS.primary,
    },
    {
      title: "Defaulters",
      value: data.defaulters ?? 0,
      icon: AlertTriangle,
      bg: COLORS.warningLight,
      color: COLORS.warning,
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))",
        gap: 20,
        marginBottom: 28,
      }}
    >
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <div
            key={card.title}
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 16,
              padding: 22,
              display: "flex",
              alignItems: "center",
              gap: 18,
              boxShadow: COLORS.shadowSm,
              transition: "0.25s",
            }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                borderRadius: 14,
                background: card.bg,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Icon size={26} color={card.color} />
            </div>

            <div>
              <div
                style={{
                  fontSize: 13,
                  color: COLORS.textSecondary,
                  marginBottom: 6,
                  fontWeight: 500,
                }}
              >
                {card.title}
              </div>

              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 30,
                  fontWeight: 700,
                  color: COLORS.text,
                }}
              >
                {card.value}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}