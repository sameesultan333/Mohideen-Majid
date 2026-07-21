import { useState } from "react";
import { Landmark, Phone, ShieldCheck, ArrowRight, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { COLORS, TYPOGRAPHY } from "../../theme/colors";
import { adminLogin } from "../../api/auth";

function LoginPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"phone" | "password">("phone");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const digitsOnly = (v: string) => v.replace(/\D/g, "");

  const goToPassword = () => {
    setError("");
    const cleaned = digitsOnly(phone);
    if (cleaned.length !== 10) {
      setError("Enter a valid 10-digit phone number");
      return;
    }
    setStep("password");
  };

  const signIn = async () => {
  setError("");

  if (!password) {
    setError("Enter your password");
    return;
  }

  try {
    setLoading(true);

    await adminLogin(digitsOnly(phone), password);

    // Navigate within the React app
    navigate("/dashboard", { replace: true });

  } catch (err: any) {
    setError(
      err?.response?.data?.detail ||
      "Unable to sign in. Try again."
    );
  } finally {
    setLoading(false);
  }
};

  const back = () => {
    setStep("phone");
    setPassword("");
    setShowPw(false);
    setError("");
  };

  return (
    <div className="mm-login">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500;600&family=Manrope:wght@400;500;600;700&display=swap');

        * { box-sizing: border-box; }

        html, body, #root { height: 100%; }

        .mm-login {
          min-height: 100dvh;
          display: flex;
          background: ${COLORS.background};
          font-family: ${TYPOGRAPHY.fontBody};
        }

        /* ── Branding panel ───────────────────────────────────────────── */
        .mm-panel {
          flex: 1.15;
          position: relative;
          background: linear-gradient(160deg, ${COLORS.sidebar} 0%, #0F3D33 55%, ${COLORS.primary} 130%);
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: clamp(28px, 5vw, 64px) clamp(24px, 6vw, 72px);
          overflow: hidden;
          color: ${COLORS.textOnDark};
        }
        .mm-panel-pattern {
          position: absolute;
          inset: 0;
          opacity: 0.16;
          pointer-events: none;
        }
        .mm-panel-glow {
          position: absolute;
          width: 480px;
          height: 480px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(169,129,46,0.25) 0%, transparent 70%);
          top: -120px;
          right: -120px;
          pointer-events: none;
        }
        .mm-panel-content {
          position: relative;
          z-index: 1;
          max-width: 420px;
        }
        .mm-panel-mark {
          width: clamp(44px, 6vw, 60px);
          height: clamp(44px, 6vw, 60px);
          border-radius: 16px;
          background: rgba(169,129,46,0.16);
          border: 1px solid rgba(169,129,46,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: clamp(14px, 3vw, 32px);
        }
        .mm-panel-eyebrow {
          font-family: ${TYPOGRAPHY.fontBody};
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: ${COLORS.accent};
          margin-bottom: 14px;
        }
        .mm-panel-title {
          font-family: ${TYPOGRAPHY.fontDisplay};
          font-size: clamp(24px, 3.4vw, 40px);
          font-weight: 600;
          letter-spacing: -0.02em;
          line-height: 1.15;
          color: ${COLORS.textOnDark};
          margin-bottom: clamp(8px, 2vw, 18px);
        }
        .mm-panel-sub {
          font-size: 15px;
          line-height: 1.65;
          color: ${COLORS.sidebarText};
        }
        .mm-panel-footer {
          position: relative;
          z-index: 1;
          margin-top: clamp(20px, 5vw, 56px);
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: ${COLORS.sidebarTextMuted};
        }

        /* ── Form side ─────────────────────────────────────────────────── */
        .mm-form-side {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(28px, 5vw, 40px) clamp(20px, 6vw, 64px);
          background: ${COLORS.background};
        }
        .mm-card {
          width: 100%;
          max-width: 440px;
          margin: auto;
          animation: mm-rise 0.5s ease;
        }
        @keyframes mm-rise {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .mm-steps {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: clamp(20px, 4vw, 32px);
        }
        .mm-step-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${COLORS.border};
          transition: background 0.25s ease, width 0.25s ease;
        }
        .mm-step-dot.active {
          background: ${COLORS.accent};
          width: 22px;
          border-radius: 4px;
        }
        .mm-step-dot.done {
          background: ${COLORS.primary};
        }
        .mm-label {
          font-family: ${TYPOGRAPHY.fontBody};
          font-size: 13px;
          font-weight: 600;
          color: ${COLORS.text};
          letter-spacing: 0.01em;
          display: block;
          margin-bottom: 10px;
        }
        .mm-input-wrap {
          display: flex;
          align-items: center;
          background: ${COLORS.surface};
          border: 1.5px solid ${COLORS.border};
          border-radius: 12px;
          padding: 0 18px;
          height: 58px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .mm-input-wrap:focus-within {
          border-color: ${COLORS.primary};
          box-shadow: 0 0 0 4px ${COLORS.primaryLight};
        }
        .mm-input-wrap input {
          border: none;
          outline: none;
          background: transparent;
          margin-left: 12px;
          flex: 1;
          font-size: 16px;
          font-family: ${TYPOGRAPHY.fontMono};
          letter-spacing: 0.5px;
          color: ${COLORS.text};
        }
        .mm-input-wrap input::placeholder {
          font-family: ${TYPOGRAPHY.fontBody};
          letter-spacing: 0;
          color: ${COLORS.textMuted};
        }
        .mm-country {
          font-family: ${TYPOGRAPHY.fontMono};
          font-size: 15px;
          color: ${COLORS.textSecondary};
          padding-right: 10px;
          border-right: 1px solid ${COLORS.border};
        }
        .mm-eye-btn {
          background: none;
          border: none;
          padding: 0 0 0 10px;
          cursor: pointer;
          display: flex;
          align-items: center;
          color: ${COLORS.textMuted};
          transition: color 0.15s ease;
        }
        .mm-eye-btn:hover { color: ${COLORS.text}; }
        .mm-btn-primary {
          width: 100%;
          height: 58px;
          margin-top: 28px;
          border: none;
          border-radius: 12px;
          background: ${COLORS.primary};
          color: ${COLORS.white};
          font-family: ${TYPOGRAPHY.fontBody};
          font-weight: 600;
          font-size: 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
          box-shadow: ${COLORS.shadowPrimary};
          transition: background 0.2s ease, transform 0.1s ease;
        }
        .mm-btn-primary:hover:not(:disabled) { background: ${COLORS.primaryHover}; }
        .mm-btn-primary:active:not(:disabled) { transform: scale(0.98); }
        .mm-btn-primary:disabled { opacity: 0.65; cursor: not-allowed; }
        .mm-btn-ghost {
          width: 100%;
          height: 44px;
          margin-top: 12px;
          border: none;
          background: transparent;
          color: ${COLORS.textSecondary};
          font-weight: 600;
          font-size: 13.5px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
        }
        .mm-btn-ghost:hover { color: ${COLORS.primary}; }
        .mm-error {
          margin-top: 16px;
          padding: 12px 14px;
          background: ${COLORS.dangerLight};
          border: 1px solid rgba(161,58,58,0.25);
          border-radius: 10px;
          color: ${COLORS.danger};
          font-size: 13px;
          font-weight: 500;
        }
        .mm-phone-preview {
          font-family: ${TYPOGRAPHY.fontMono};
          color: ${COLORS.text};
          font-weight: 600;
        }
        .mm-secure-note {
          margin-top: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          font-size: 12.5px;
          color: ${COLORS.textMuted};
        }

        @media (max-width: 900px) {
          .mm-login { flex-direction: column; min-height: 100dvh; height: auto; }
          .mm-panel { flex: none; padding: 28px 24px; min-height: 0; }
          .mm-panel-sub { display: none; }
          .mm-panel-footer { margin-top: 20px; }
          .mm-form-side { flex: 1; padding: 32px 20px 40px; }
        }
        @media (max-width: 480px) {
          .mm-panel-title { font-size: 22px; }
          .mm-panel-eyebrow { margin-bottom: 8px; }
          .mm-panel-mark { margin-bottom: 12px; }
        }
      `}</style>

      {/* Identity panel */}
      <div className="mm-panel">
        <div className="mm-panel-glow" />
        <svg className="mm-panel-pattern" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="star8" width="60" height="60" patternUnits="userSpaceOnUse">
              <g stroke={COLORS.accent} strokeWidth="1" fill="none">
                <path d="M30 4 L36 20 L54 16 L42 30 L54 44 L36 40 L30 56 L24 40 L6 44 L18 30 L6 16 L24 20 Z" />
              </g>
            </pattern>
          </defs>
          <rect width="400" height="400" fill="url(#star8)" />
        </svg>

        <div className="mm-panel-content">
          <div className="mm-panel-mark">
            <Landmark size={28} color={COLORS.accent} />
          </div>
          <div className="mm-panel-eyebrow">Administration Portal</div>
          <div className="mm-panel-title">Mohideen Masjid</div>
          <p className="mm-panel-sub">
            A dedicated space for the committee to manage families, chanda
            collections, donations, and expenses with clarity and care.
          </p>
        </div>

        <div className="mm-panel-footer">
          <ShieldCheck size={16} color={COLORS.accent} />
          Access restricted to authorised administrators
        </div>
      </div>

      {/* Form side */}
      <div className="mm-form-side">
        <div className="mm-card">
          <div className="mm-steps">
            <div className={`mm-step-dot ${step === "phone" ? "active" : "done"}`} />
            <div className={`mm-step-dot ${step === "password" ? "active" : ""}`} />
          </div>

          {step === "phone" && (
            <>
              <h1 style={{
                fontFamily: TYPOGRAPHY.fontDisplay,
                fontSize: "26px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: COLORS.text,
                marginBottom: "8px",
              }}>
                Sign in
              </h1>
              <p style={{ color: COLORS.textSecondary, fontSize: "14px", marginBottom: "32px" }}>
                Enter your registered phone number to continue.
              </p>

              <label className="mm-label">Phone number</label>
              <div className="mm-input-wrap">
                <span className="mm-country">+91</span>
                <Phone size={18} color={COLORS.primary} />
                <input
                  value={phone}
                  onChange={(e) => setPhone(digitsOnly(e.target.value).slice(0, 10))}
                  onKeyDown={(e) => e.key === "Enter" && goToPassword()}
                  placeholder="98765 43210"
                  inputMode="numeric"
                  autoFocus
                />
              </div>

              {error && <div className="mm-error">{error}</div>}

              <button className="mm-btn-primary" onClick={goToPassword}>
                Continue
                <ArrowRight size={17} />
              </button>
            </>
          )}

          {step === "password" && (
            <>
              <h1 style={{
                fontFamily: TYPOGRAPHY.fontDisplay,
                fontSize: "26px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: COLORS.text,
                marginBottom: "8px",
              }}>
                Enter password
              </h1>
              <p style={{ color: COLORS.textSecondary, fontSize: "14px", marginBottom: "32px" }}>
                Signing in as <span className="mm-phone-preview">+91 {phone}</span>
              </p>

              <label className="mm-label">Password</label>
              <div className="mm-input-wrap">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && signIn()}
                  placeholder="••••••••"
                  autoFocus
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="mm-eye-btn"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {error && <div className="mm-error">{error}</div>}

              <button className="mm-btn-primary" onClick={signIn} disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
                {!loading && <ArrowRight size={17} />}
              </button>

              <button className="mm-btn-ghost" onClick={back}>
                <ArrowLeft size={15} />
                Use a different number
              </button>
            </>
          )}

          <div className="mm-secure-note">
            <ShieldCheck size={14} color={COLORS.textMuted} />
            Secured with password authentication
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
