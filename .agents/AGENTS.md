# Custom Rules for HalalVeggSupplies

## UI & Icons
- When adding or editing icons in the project, always use the Material Design Icons (Community) set from this reference: https://www.figma.com/design/sPeYbtRYYWlS9VqJrYRoyL/Material-Design-Icons--Community-?node-id=2402-2207&p=f&t=ddz30Tg491nnoRK5-0 (implemented via `@mdi/react` and `@mdi/js`).
- Keep navbar and sidebar icons (which use the `@solar-icons/react` package) preserved and unchanged.

## Inventory & Transactional Editing Rules (CRITICAL)
- **Delta-Only Validation on Edits**:
  - Whenever an existing transaction (e.g. Sales Invoice, Purchase Voucher) is edited, NEVER re-validate or re-deduct existing unchanged quantities.
  - Calculate `delta = submittedQty - persistedOriginalQty` per `productId`.
  - **`delta === 0`**: Skip completely. Zero inventory mutation, zero validation errors.
  - **`delta > 0`**: Only validate and deduct the additional positive delta (`delta <= availableStock`).
  - **`delta < 0`**: Restore `abs(delta)` to inventory.
- **Frontend & Backend Symmetry**:
  - Both frontend pre-submission checks and backend transactional logic must strictly use delta-only calculations. Never compare full quantity against warehouse stock when editing an existing invoice.
- **Product ID as Single Source of Truth**:
  - Always match and compare line items by `productId`.
- **Product Visuals Single Source of Truth**:
  - All visual outputs (Price List download/view, Invoice print/PDF/WhatsApp, Purchase vouchers, Inventory views, Delivery cards) must faithfully follow the **Product Master Catalog** uploaded image (`imageUrl`) or emoji (`emoji`).

