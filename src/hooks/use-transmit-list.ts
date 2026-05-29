/** Thin hook over the localStorage transmit-row store. Provides CRUD operations
 *  with stable identities so React can re-render only the affected rows. */

import * as React from "react";

import {
  createRow,
  loadRows,
  saveRows,
  type NewTransmitRow,
  type TransmitRow,
} from "@/lib/transmit-store";

export interface UseTransmitListReturn {
  rows: readonly TransmitRow[];
  addRow: (input: NewTransmitRow) => TransmitRow;
  updateRow: (id: string, patch: Partial<TransmitRow>) => void;
  removeRow: (id: string) => void;
}

export function useTransmitList(): UseTransmitListReturn {
  const [rows, setRows] = React.useState<readonly TransmitRow[]>(() => loadRows());

  React.useEffect(() => {
    saveRows(rows);
  }, [rows]);

  const addRow = React.useCallback((input: NewTransmitRow): TransmitRow => {
    const row = createRow(input);
    setRows((prev) => [...prev, row]);
    return row;
  }, []);

  const updateRow = React.useCallback((id: string, patch: Partial<TransmitRow>): void => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const removeRow = React.useCallback((id: string): void => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { rows, addRow, updateRow, removeRow };
}
