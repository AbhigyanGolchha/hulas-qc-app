'use client';
// Tick-boxes + "Delete selected" for report lists (only rendered for roles
// allowed to delete). The checkboxes live in the table and join the hidden
// bulk form through the HTML form="…" attribute.
import { useEffect, useState } from 'react';

export function SelectAll({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${formId}"][name="ids"]`).forEach((c) => {
          c.checked = e.target.checked;
          c.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }}
    />
  );
}

export function BulkDeleteButton({ formId, noun }: { formId: string; noun: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const recount = () => setCount(document.querySelectorAll(`input[type=checkbox][form="${formId}"][name="ids"]:checked`).length);
    document.addEventListener('change', recount);
    recount();
    return () => document.removeEventListener('change', recount);
  }, [formId]);
  return (
    <button
      type="submit"
      form={formId}
      className="btn-danger"
      disabled={!count}
      onClick={(e) => {
        if (!window.confirm(`Permanently delete ${count} ${noun}${count === 1 ? '' : 's'}? This cannot be undone (the audit log keeps a record of the deletion).`)) e.preventDefault();
      }}
    >
      Delete selected{count ? ` (${count})` : ''}
    </button>
  );
}
