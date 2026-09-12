import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Button } from './UI.jsx';

/**
 * A settings row that edits in place.
 *
 * Tapping the row turns the value into an input; Enter or Save commits, Escape
 * or Cancel reverts. This avoids the usual pattern of a modal per field, where
 * changing one number means opening a dialog, finding the field, and saving a
 * form that also contains four things you did not want to touch.
 *
 * `readOnly` rows still render, optionally with their own action, so things
 * that need a verification step (a phone number, a payout account) sit in the
 * same list and look consistent.
 */
export function EditableRow({
  label,
  value,
  editValue,
  type = 'text',
  hint,
  placeholder,
  readOnly = false,
  action,
  onSave,
  validate,
  formatDisplay,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) {
      setDraft(editValue ?? value ?? '');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [editing, value, editValue]);

  const commit = async () => {
    const problem = validate?.(draft);
    if (problem) {
      setError(problem);
      return;
    }
    // Nothing changed: close quietly rather than firing a pointless request.
    if (String(draft).trim() === String(editValue ?? value ?? '').trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (err) {
      setError(err.message || 'Could not save that');
    } finally {
      setBusy(false);
    }
  };

  const displayed = formatDisplay ? formatDisplay(value) : value;

  if (editing) {
    return (
      <div className="editable-row editing">
        <div className="editable-row-label">{label}</div>
        <div className="editable-row-edit">
          <input
            ref={inputRef}
            className={`input ${error ? 'error' : ''}`}
            type={type}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            inputMode={type === 'tel' ? 'tel' : undefined}
            autoCapitalize={type === 'email' ? 'none' : undefined}
          />
          <div className="editable-row-actions">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={commit} loading={busy}>
              Save
            </Button>
          </div>
        </div>
        {error ? (
          <div className="field-error" style={{ gridColumn: '1 / -1' }}>
            <Icon name="alert-circle" size={13} />
            <span>{error}</span>
          </div>
        ) : hint ? (
          <div className="field-hint" style={{ gridColumn: '1 / -1' }}>
            {hint}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`editable-row ${readOnly ? 'readonly' : ''}`}
      onClick={readOnly ? undefined : () => setEditing(true)}
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      onKeyDown={
        readOnly
          ? undefined
          : (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setEditing(true))
      }
    >
      <div className="editable-row-label">{label}</div>
      <div className="editable-row-value">
        <span className="editable-row-text">{displayed || <em>Not set</em>}</span>
        {action ? (
          <button
            className="editable-row-action"
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
          >
            {action.label}
          </button>
        ) : readOnly ? null : (
          <Icon name="edit" size={15} className="editable-row-pencil" />
        )}
      </div>
      {hint && <div className="field-hint editable-row-hint">{hint}</div>}
    </div>
  );
}

export default EditableRow;
