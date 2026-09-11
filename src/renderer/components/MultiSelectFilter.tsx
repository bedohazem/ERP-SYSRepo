import { useState, type CSSProperties } from 'react'

export type MultiSelectOption = {
  value: string
  label: string
}

type Props = {
  label: string
  allLabel: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (values: string[]) => void
  controlStyle?: CSSProperties
}

export default function MultiSelectFilter({
  label,
  allLabel,
  options,
  selected,
  onChange,
  controlStyle,
}: Props) {
  const [open, setOpen] = useState(false)

  function toggleValue(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value))

      return
    }

    onChange([...selected, value])
  }

  const selectedText =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((option) => option.value === selected[0])?.label ||
          selected[0]
        : `${selected.length} اختيارات محددة`

  return (
    <div
      style={{
        display: 'grid',
        gap: '8px',
        position: 'relative',
        minWidth: 0,
        zIndex: open ? 300 : 1,
      }}
    >
      <span
        style={{
          color: '#cbd5e1',
          fontWeight: 800,
        }}
      >
        {label}
      </span>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          ...controlStyle,
          width: '100%',
          cursor: 'pointer',
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {selectedText}
      </button>

      {open && (
        <div
          className="theme-popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            left: 0,
            zIndex: 1000,
            maxHeight: '340px',
            overflowY: 'auto',
            padding: '10px',
            borderRadius: '12px',
            background: '#0f172a',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 18px 45px rgba(0,0,0,0.45)',
            display: 'grid',
            gap: '6px',
          }}
        >
          <button
            type="button"
            onClick={() => onChange([])}
            style={{
              width: '100%',
              minHeight: '36px',
              padding: '8px 10px',
              borderRadius: '9px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)',
              color: '#f8fafc',
              textAlign: 'right',
              fontWeight: 800,
            }}
          >
            ✓ {allLabel}
          </button>

          {options.map((option) => {
            const checked = selected.includes(option.value)

            return (
              <label
                key={option.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  padding: '8px 9px',
                  borderRadius: '9px',
                  cursor: 'pointer',
                  background: checked ? 'rgba(37,99,235,0.16)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleValue(option.value)}
                />

                <span>{option.label}</span>
              </label>
            )
          })}

          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              width: '100%',
              minHeight: '36px',
              marginTop: '5px',
              border: 0,
              borderRadius: '9px',
              background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
              color: '#fff',
              fontWeight: 900,
            }}
          >
            تم
          </button>
        </div>
      )}
    </div>
  )
}
