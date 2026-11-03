// src/components.tsx
import { createElement, useEffect, useId, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var H = (d) => d === "compact" ? "var(--control-h-compact)" : "var(--control-h-comfortable)";
function Icon({ name, size = 24, fill = false, weight = 400, color, style, ...rest }) {
  return createElement("span", {
    "aria-hidden": "true",
    ...rest,
    style: { fontFamily: "var(--font-icon)", fontWeight: "normal", fontStyle: "normal", fontSize: size, width: size, height: size, lineHeight: 1, letterSpacing: "normal", textTransform: "none", whiteSpace: "nowrap", fontFeatureSettings: "'liga'", WebkitFontSmoothing: "antialiased", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, userSelect: "none", overflow: "hidden", fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${Math.min(48, Math.max(20, size))}`, color, ...style }
  }, name);
}
var BV = {
  primary: { bg: "var(--primary)", hover: "var(--primary-hover)", press: "var(--primary-pressed)", fg: "var(--on-primary)", border: "transparent" },
  secondary: { bg: "var(--surface-2)", hover: "#262626", press: "#2E2E2E", fg: "var(--text-primary)", border: "var(--border-1)" },
  destructive: { bg: "var(--status-error)", hover: "#FF6E6E", press: "#E64848", fg: "var(--gc-black)", border: "transparent" },
  text: { bg: "transparent", hover: "var(--state-hover)", press: "var(--state-pressed)", fg: "var(--primary)", border: "transparent" }
};
function GreenCrewButton({ children, variant = "primary", size = "md", density, icon, trailingIcon, iconOnly = false, disabled = false, fullWidth = false, onClick, type = "button", style, ...rest }) {
  const [h, setH] = useState(false), [p, setP] = useState(false);
  const v = BV[variant] || BV.primary, lg = size === "lg", sm = size === "sm", compact = density === "compact";
  const bg = disabled ? variant === "text" ? "transparent" : "var(--surface-2)" : p ? v.press : h ? v.hover : v.bg;
  return /* @__PURE__ */ jsxs(
    "button",
    {
      ...rest,
      type,
      disabled,
      onClick,
      onMouseEnter: () => setH(true),
      onMouseLeave: () => {
        setH(false);
        setP(false);
      },
      onMouseDown: () => setP(true),
      onMouseUp: () => setP(false),
      style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: lg ? 56 : sm ? 36 : H(density),
        minWidth: iconOnly ? sm ? 36 : H(density) : compact || sm ? 36 : 48,
        padding: iconOnly ? 0 : variant === "text" ? "0 12px" : lg ? "0 24px" : sm ? "0 12px" : compact ? "0 16px" : "0 20px",
        width: fullWidth ? "100%" : void 0,
        borderRadius: lg ? "var(--radius-button-lg)" : "var(--radius-button)",
        border: `1px solid ${disabled ? "transparent" : v.border}`,
        background: bg,
        color: disabled ? "var(--text-disabled)" : v.fg,
        fontFamily: "var(--font-sans)",
        fontSize: lg ? 16 : sm ? 13 : 14,
        fontWeight: 700,
        letterSpacing: ".02em",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background var(--dur-fast) var(--ease-standard)",
        ...style
      },
      children: [
        icon && /* @__PURE__ */ jsx(Icon, { name: icon, size: 20 }),
        children,
        trailingIcon && /* @__PURE__ */ jsx(Icon, { name: trailingIcon, size: 20 })
      ]
    }
  );
}
function GreenCrewTextField({ label, value, defaultValue, onChange, placeholder, unit, helper, error, type = "text", inputMode, disabled = false, required = false, style, id }) {
  const [f, setF] = useState(false), auto = useId(), fid = id ?? auto;
  const bc = error ? "var(--status-error)" : f ? "var(--primary)" : "var(--border-1)";
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--font-sans)", opacity: disabled ? 0.5 : 1, ...style }, children: [
    label && /* @__PURE__ */ jsxs("label", { htmlFor: fid, style: { fontSize: 13, color: error ? "var(--status-error)" : "var(--text-secondary)" }, children: [
      label,
      required && " *"
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", height: 48, background: "var(--surface-2)", border: `1px solid ${bc}`, boxShadow: f && !error ? "0 0 0 1px var(--primary)" : "none", borderRadius: "var(--radius-field)", padding: "0 12px", gap: 8 }, children: [
      /* @__PURE__ */ jsx(
        "input",
        {
          id: fid,
          type,
          inputMode,
          value,
          defaultValue,
          placeholder,
          disabled,
          onChange: (e) => onChange && onChange(e.target.value),
          onFocus: () => setF(true),
          onBlur: () => setF(false),
          style: { flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--text-primary)", fontFamily: "inherit", fontSize: 16, fontVariantNumeric: "tabular-nums" }
        }
      ),
      unit && /* @__PURE__ */ jsx("span", { style: { fontSize: 14, color: "var(--text-secondary)" }, children: unit }),
      error && /* @__PURE__ */ jsx(Icon, { name: "error", size: 20, fill: true, color: "var(--status-error)" })
    ] }),
    (error || helper) && /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: error ? "var(--status-error)" : "var(--text-secondary)" }, children: error || helper })
  ] });
}
function GreenCrewCheckbox({ checked, onChange, size, label, disabled, id, density }) {
  size ??= density === "compact" ? 20 : 28;
  const box = /* @__PURE__ */ jsx(
    "span",
    {
      id,
      role: "checkbox",
      "aria-checked": !!checked,
      "aria-disabled": disabled,
      onClick: (e) => {
        e.stopPropagation();
        if (!disabled && onChange) onChange(!checked);
      },
      style: { width: size, height: size, flex: "none", boxSizing: "border-box", borderRadius: size >= 24 ? 8 : 6, border: "1.5px solid " + (checked ? "var(--primary)" : "var(--text-disabled)"), background: checked ? "var(--primary)" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 },
      children: checked && /* @__PURE__ */ jsx(Icon, { name: "check", size: size >= 24 ? 20 : 16, weight: 700, color: "var(--on-primary)" })
    }
  );
  if (!label) return box;
  return /* @__PURE__ */ jsxs("label", { onClick: () => {
    if (!disabled && onChange) onChange(!checked);
  }, style: { display: "flex", alignItems: "center", gap: 10, minHeight: "var(--touch-min)", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-primary)", cursor: disabled ? "not-allowed" : "pointer" }, children: [
    box,
    label
  ] });
}
var CT = { ok: ["var(--success-tint)", "var(--primary-text)"], error: ["var(--error-tint)", "var(--status-error)"], warning: ["var(--warning-tint)", "var(--status-warning)"], info: ["var(--info-tint)", "var(--status-info)"], neutral: ["var(--surface-2)", "var(--text-secondary)"], overlay: ["var(--overlay-chip)", "var(--text-primary)"] };
function GreenCrewStatusChip({ tone = "ok", icon, children, title }) {
  const [bg, fg] = CT[tone] || CT.ok, ov = tone === "overlay";
  return /* @__PURE__ */ jsxs("span", { title, style: { display: "inline-flex", alignItems: "center", gap: 5, padding: ov ? "4px 8px" : "5px 10px", borderRadius: ov ? "var(--radius-badge)" : "var(--radius-chip)", background: bg, color: fg, fontFamily: "var(--font-sans)", fontSize: ov ? 11 : 12, fontWeight: 700, whiteSpace: "nowrap" }, children: [
    icon && /* @__PURE__ */ jsx(Icon, { name: icon, size: ov ? 14 : 16 }),
    children
  ] });
}
function GreenCrewCard({ title, subtitle, icon, trailing, children, onClick, padding = 16, style }) {
  const [h, setH] = useState(false), click = !!onClick;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      onClick,
      onMouseEnter: () => setH(true),
      onMouseLeave: () => setH(false),
      role: click ? "button" : void 0,
      style: { background: click && h ? "var(--surface-2)" : "var(--surface-card)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-card)", padding, cursor: click ? "pointer" : "default", transition: "background var(--dur-fast) var(--ease-standard)", color: "var(--text-primary)", fontFamily: "var(--font-sans)", ...style },
      children: [
        (title || trailing) && /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "flex-start", gap: 12, marginBottom: children ? 12 : 0 }, children: [
          icon && /* @__PURE__ */ jsx(Icon, { name: icon, size: 24, color: "var(--primary)" }),
          /* @__PURE__ */ jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
            title && /* @__PURE__ */ jsx("div", { style: { fontSize: 16, fontWeight: 700, lineHeight: 1.3 }, children: title }),
            subtitle && /* @__PURE__ */ jsx("div", { style: { fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }, children: subtitle })
          ] }),
          trailing
        ] }),
        children
      ]
    }
  );
}
function GreenCrewSectionHeader({ title, count, actionLabel, onAction, style }) {
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, minHeight: 40, fontFamily: "var(--font-sans)", ...style }, children: [
    /* @__PURE__ */ jsxs("div", { style: { flex: 1, fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }, children: [
      title,
      count != null && /* @__PURE__ */ jsx("span", { style: { fontSize: 14, fontWeight: 400, color: "var(--text-secondary)", marginLeft: 8 }, children: count })
    ] }),
    actionLabel && /* @__PURE__ */ jsx("button", { onClick: onAction, style: { height: 40, padding: "0 8px", background: "none", border: "none", color: "var(--primary)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }, children: actionLabel })
  ] });
}
function GreenCrewSegmented({ options, value, onChange, fill = false, size = "md" }) {
  const h = size === "lg" ? 40 : size === "sm" ? 34 : 38;
  return /* @__PURE__ */ jsx("div", { role: "radiogroup", style: { display: fill ? "grid" : "inline-flex", gridTemplateColumns: fill ? "repeat(" + options.length + ",minmax(0,1fr))" : void 0, gap: 4, padding: 4, background: "var(--bg-app)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-button)" }, children: options.map((o) => {
    const v = typeof o === "string" ? o : o.value, on = v === value, icon = typeof o === "string" ? void 0 : o.icon;
    return /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        role: "radio",
        "aria-checked": on,
        onClick: () => onChange && onChange(v),
        style: { height: h, padding: "0 14px", border: 0, borderRadius: 8, background: on ? "var(--surface-2)" : "transparent", color: on ? "var(--text-primary)" : "var(--text-secondary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: on ? 700 : 400, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, whiteSpace: "nowrap", transition: "background var(--dur-fast) var(--ease-standard)" },
        children: [
          icon && /* @__PURE__ */ jsx(Icon, { name: icon, size: 18 }),
          typeof o === "string" ? o : o.label
        ]
      },
      v
    );
  }) });
}
function GreenCrewConfirmDialog({ open = true, title, message, confirmLabel = "Usu\u0144", cancelLabel = "Anuluj", destructive = true, icon, onConfirm, onCancel, inline = false }) {
  if (!open) return null;
  const box = /* @__PURE__ */ jsxs("div", { role: "dialog", "aria-modal": "true", style: { width: "100%", maxWidth: 360, background: "var(--surface-2)", borderRadius: "var(--radius-dialog)", boxShadow: "var(--shadow-dialog)", padding: 24, fontFamily: "var(--font-sans)", color: "var(--text-primary)" }, children: [
    (icon || destructive) && /* @__PURE__ */ jsx(Icon, { name: icon || "delete", size: 28, color: destructive ? "var(--status-error)" : "var(--primary)", style: { marginBottom: 12 } }),
    /* @__PURE__ */ jsx("div", { style: { fontSize: 20, fontWeight: 700, lineHeight: 1.3 }, children: title }),
    message && /* @__PURE__ */ jsx("div", { style: { fontSize: 14, color: "var(--text-secondary)", marginTop: 8, lineHeight: 1.45 }, children: message }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }, children: [
      /* @__PURE__ */ jsx(GreenCrewButton, { variant: "secondary", onClick: onCancel, children: cancelLabel }),
      /* @__PURE__ */ jsx(GreenCrewButton, { variant: destructive ? "destructive" : "primary", onClick: onConfirm, children: confirmLabel })
    ] })
  ] });
  if (inline) return box;
  return /* @__PURE__ */ jsx("div", { onClick: onCancel, style: { position: "absolute", inset: 0, zIndex: 50, background: "var(--scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }, children: /* @__PURE__ */ jsx("div", { onClick: (e) => e.stopPropagation(), style: { width: "100%", maxWidth: 360 }, children: box }) });
}
function GreenCrewField({ label, required, hint, error, children, grow, minWidth, style }) {
  return /* @__PURE__ */ jsxs("label", { style: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flexGrow: grow ?? 1, flexBasis: minWidth ?? 130, fontFamily: "var(--font-sans)", ...style }, children: [
    /* @__PURE__ */ jsxs("span", { style: { fontSize: 13, color: error ? "var(--status-error)" : "var(--text-secondary)" }, children: [
      label,
      required && /* @__PURE__ */ jsx("span", { style: { color: "var(--primary)", marginLeft: 2 }, children: "*" })
    ] }),
    children,
    (error || hint) && /* @__PURE__ */ jsx("span", { style: { fontSize: 12, color: error ? "var(--status-error)" : "var(--text-secondary)", lineHeight: 1.4 }, children: error || hint })
  ] });
}
var controlStyle = (density, invalid) => ({ boxSizing: "border-box", width: "100%", height: H(density), padding: "0 12px", background: "var(--surface-1)", border: `1px solid ${invalid ? "var(--status-error)" : "var(--border-2)"}`, borderRadius: "var(--radius-field)", color: "var(--text-primary)", fontFamily: "var(--font-sans)", fontSize: density === "compact" ? 14 : 16, fontVariantNumeric: "tabular-nums", outline: "none" });
function GreenCrewInput({ onChange, density, invalid, style, onFocus, onBlur, ...rest }) {
  const [f, setF] = useState(false);
  return /* @__PURE__ */ jsx(
    "input",
    {
      ...rest,
      onChange: (e) => onChange && onChange(e.target.value, e),
      onFocus: (e) => {
        setF(true);
        onFocus?.(e);
      },
      onBlur: (e) => {
        setF(false);
        onBlur?.(e);
      },
      style: { ...controlStyle(density, invalid), borderColor: invalid ? "var(--status-error)" : f ? "var(--primary)" : "var(--border-2)", boxShadow: f && !invalid ? "0 0 0 1px var(--primary)" : "none", ...style }
    }
  );
}
function GreenCrewSelect({ options, onChange, density, invalid, style, ...rest }) {
  return /* @__PURE__ */ jsx("select", { ...rest, onChange: (e) => onChange && onChange(e.target.value, e), style: { ...controlStyle(density, invalid), ...style }, children: options.map(([v, l]) => /* @__PURE__ */ jsx("option", { value: v, children: l }, v)) });
}
var NT = { ok: ["var(--success-tint)", "var(--primary)", "var(--primary-text)", "check_circle"], error: ["var(--error-tint)", "var(--status-error)", "var(--status-error)", "error"], warning: ["var(--warning-tint)", "var(--status-warning)", "var(--status-warning)", "warning"], info: ["var(--info-tint)", "var(--status-info)", "var(--status-info)", "info"] };
function GreenCrewNotice({ tone = "info", children, id, icon }) {
  const [bg, bd, fg, ic] = NT[tone];
  return /* @__PURE__ */ jsxs("div", { id, role: tone === "error" ? "alert" : "status", style: { display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px", borderRadius: "var(--radius-field)", border: `1px solid ${bd}`, background: bg, color: fg, fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.45 }, children: [
    (icon ?? ic) && /* @__PURE__ */ jsx(Icon, { name: icon ?? ic, size: 18 }),
    /* @__PURE__ */ jsx("div", { style: { minWidth: 0 }, children })
  ] });
}
function GreenCrewDialog({ id, title, onClose, footer, children, width = 560 }) {
  const ref = useRef(null), tid = useId();
  useEffect(() => {
    ref.current?.querySelector("input,select,button:not([data-gc-close])")?.focus();
  }, []);
  return /* @__PURE__ */ jsx(
    "div",
    {
      id,
      className: "gc-overlay",
      onMouseDown: (e) => {
        if (e.target === e.currentTarget) onClose();
      },
      onKeyDown: (e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      },
      style: { position: "fixed", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--scrim)", fontFamily: "var(--font-sans)" },
      children: /* @__PURE__ */ jsxs("div", { ref, className: "gc-dialog gc-scroll", role: "dialog", "aria-modal": "true", "aria-labelledby": tid, style: { display: "flex", flexDirection: "column", width, maxWidth: "100%", maxHeight: "calc(100vh - 32px)", background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-dialog)", boxShadow: "var(--shadow-dialog)" }, children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--border-1)" }, children: [
          /* @__PURE__ */ jsx("h2", { id: tid, style: { flex: 1, margin: 0, fontSize: "var(--fs-section-title)", fontWeight: 700 }, children: title }),
          /* @__PURE__ */ jsx(GreenCrewButton, { variant: "text", size: "sm", iconOnly: true, icon: "close", "aria-label": "Zamknij", "data-gc-close": true, onClick: onClose, style: { color: "var(--text-secondary)" } })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "gc-scroll", style: { flex: 1, minHeight: 0, overflow: "auto", padding: 24 }, children }),
        footer && /* @__PURE__ */ jsx("div", { style: { display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", padding: "12px 24px", borderTop: "1px solid var(--border-1)", background: "var(--surface-1)", borderRadius: "0 0 var(--radius-dialog) var(--radius-dialog)" }, children: footer })
      ] })
    }
  );
}
export {
  GreenCrewButton,
  GreenCrewCard,
  GreenCrewCheckbox,
  GreenCrewConfirmDialog,
  GreenCrewDialog,
  GreenCrewField,
  GreenCrewInput,
  GreenCrewNotice,
  GreenCrewSectionHeader,
  GreenCrewSegmented,
  GreenCrewSelect,
  GreenCrewStatusChip,
  GreenCrewTextField,
  Icon
};
