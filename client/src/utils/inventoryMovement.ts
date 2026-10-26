/** Manual stock changes already retain their direction in the signed quantity. */
export function inventoryMovementLabel(type: string, quantity: number | string): string {
  if (type === 'adjustment') {
    if (Number(quantity) > 0) return 'Added Stock';
    if (Number(quantity) < 0) return 'Deducted Stock';
    return 'Stock Adjustment';
  }
  return type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
