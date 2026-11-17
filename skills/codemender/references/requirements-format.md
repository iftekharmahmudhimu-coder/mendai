# Requirement files

One markdown file per module in `requirements/` (configurable via `requirementsDir` in `codemender.config.json`). Files ending in `.md`, `.markdown` or `.txt` are read.

- Every unchecked checkbox (`- [ ]`, `* [ ]`, `+ [ ]`) is one task.
- Checked boxes (`- [x]`) are already done and are skipped.
- Indented lines under an item are its **details**: acceptance criteria, validation rules, response shapes.
- The nearest `##` heading above an item is its **section**. The `#` title is the **module** name.
- The whole file is context. Implement only the current item, but keep the rest of the module in mind so the pieces fit together.
- A file with no checkboxes at all is a single task. Mark it complete by appending `<!-- codemender:done -->`.

## Example

```markdown
# Orders

## Data
- [ ] `orders` table: id, user_id (FK), status (enum: pending|paid|shipped), total (decimal), timestamps
- [ ] Order model with `user()` relation and `scopePaid()`

## API
- [ ] POST /api/orders — create an order for the authenticated user
    Validate: items[] required, each with product_id and qty >= 1
    Return 201 with the order resource
- [x] GET /api/orders — already done
```

## Marking done

Only after the item is implemented **and** verified, change that exact line's `[ ]` to `[x]`. Leave the text, indentation and details unchanged. Don't tick items you skipped or only partly finished.

## Writing requirements for the user

If the user describes a module in prose and wants it tracked, write `requirements/<module>.md` in this format: small, independently verifiable items, ordered so later items build on earlier ones (data, then logic, then API/UI, then tests).
