import { type FormEvent, type ReactNode, useState } from "react";
import {
  CATEGORY_COLORS,
  type CategoryColor,
  MAX_CATEGORY_KEY_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  type RestCategory,
  type RestCategoryInput,
  type RestCategoryPatch,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { keyOf } from "./projects.js";
import { Button, CategoryBadge, cx } from "./ui.js";

// The categories tasks are sorted into (ADR-0019), as the workspace's page lists them: each in
// its colour, with the ways for an administrator to rename, recolour, add and remove one. Takes
// its data as props and nothing from the network.

export interface CategoryListProps {
  readonly categories: readonly RestCategory[];
  readonly busy?: boolean | undefined;
  /** Called with a category to add. Left out, the list is read here, not changed. */
  readonly onAdd?: ((input: RestCategoryInput) => void) | undefined;
  readonly onChange?: ((category: RestCategory, patch: RestCategoryPatch) => void) | undefined;
  readonly onRemove?: ((category: RestCategory) => void) | undefined;
  readonly empty?: ReactNode;
}

/** One category, with its name and its colour open to change where an administrator is looking. */
function CategoryRow(props: {
  readonly category: RestCategory;
  readonly busy: boolean | undefined;
  readonly onChange: ((category: RestCategory, patch: RestCategoryPatch) => void) | undefined;
  readonly onRemove: ((category: RestCategory) => void) | undefined;
}) {
  const words = useWords();
  const { category } = props;
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState<CategoryColor>(category.color);
  const changed = name.trim() !== category.name || color !== category.color;
  if (props.onChange === undefined) {
    return (
      <li className="sc-category-row">
        <CategoryBadge category={category} />
        <code className="sc-project-key">{category.key}</code>
      </li>
    );
  }
  return (
    <li className="sc-category-row">
      <form
        className="sc-category-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && name.trim() !== "") {
            props.onChange?.(category, { name: name.trim(), color });
          }
        }}
      >
        <span className={cx("sc-category-swatch", `sc-category-${color}`)} aria-hidden="true" />
        <label className="sc-field sc-field-inline">
          <span className="sc-visually-hidden">{words.categories.nameOf(category.key)}</span>
          <input
            className="sc-input"
            value={name}
            maxLength={MAX_CATEGORY_NAME_LENGTH}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <code className="sc-project-key">{category.key}</code>
        <label className="sc-field sc-field-inline">
          <span className="sc-visually-hidden">{words.categories.colorOf(category.key)}</span>
          <select
            className="sc-input"
            value={color}
            onChange={(event) => setColor(event.target.value as CategoryColor)}
          >
            {CATEGORY_COLORS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {words.vocabulary.categoryColor[candidate]}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={props.busy === true || !changed || name.trim() === ""}
        >
          {words.common.save}
        </Button>
        {props.onRemove !== undefined && (
          <Button
            variant="danger"
            size="sm"
            disabled={props.busy === true}
            onClick={() => props.onRemove?.(category)}
          >
            {words.common.remove}
          </Button>
        )}
      </form>
    </li>
  );
}

export function CategoryList(props: CategoryListProps) {
  const words = useWords();
  const form = words.categories.form;
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [color, setColor] = useState<CategoryColor>("gray");
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "" || key.trim() === "") {
      return;
    }
    props.onAdd?.({ key: key.trim(), name: name.trim(), color });
    setName("");
    setKey("");
    setKeyTouched(false);
    setColor("gray");
  };
  return (
    <div className="sc-categories">
      {props.categories.length === 0 ? (
        (props.empty ?? null)
      ) : (
        <ul className="sc-category-list" aria-label={words.categories.list}>
          {props.categories.map((category) => (
            <CategoryRow
              key={category.key}
              category={category}
              busy={props.busy}
              onChange={props.onChange}
              onRemove={props.onRemove}
            />
          ))}
        </ul>
      )}
      {props.onAdd !== undefined && (
        <form
          className="sc-form sc-member-form"
          aria-label={words.categories.addAria}
          onSubmit={add}
        >
          <div className="sc-field-row">
            <label className="sc-field">
              <span className="sc-field-label">{form.name}</span>
              <input
                className="sc-input"
                value={name}
                maxLength={MAX_CATEGORY_NAME_LENGTH}
                required
                onChange={(event) => {
                  setName(event.target.value);
                  if (!keyTouched) {
                    setKey(keyOf(event.target.value).slice(0, MAX_CATEGORY_KEY_LENGTH));
                  }
                }}
              />
            </label>
            <label className="sc-field">
              <span className="sc-field-label">{form.key}</span>
              <input
                className="sc-input"
                value={key}
                maxLength={MAX_CATEGORY_KEY_LENGTH}
                pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                required
                title={form.keyHint}
                onChange={(event) => {
                  setKeyTouched(true);
                  setKey(event.target.value);
                }}
              />
            </label>
            <label className="sc-field">
              <span className="sc-field-label">{form.color}</span>
              <select
                className="sc-input"
                value={color}
                onChange={(event) => setColor(event.target.value as CategoryColor)}
              >
                {CATEGORY_COLORS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {words.vocabulary.categoryColor[candidate]}
                  </option>
                ))}
              </select>
            </label>
            <div className="sc-form-actions">
              <Button
                type="submit"
                variant="primary"
                disabled={props.busy === true || name.trim() === "" || key.trim() === ""}
              >
                {form.add}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
