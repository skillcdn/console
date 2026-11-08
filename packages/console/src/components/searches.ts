import type { RestGoal, RestPerson, RestProject } from "../api.js";
import type { PickerSearch } from "./picker.js";
import { personName } from "./ui.js";

// What a picker asks for, answered from a listing the page already holds (ADR-0037): the people,
// the projects or the goals the page was given, found by the words typed, a page at a time, so
// that choosing one among many is the same wherever one is chosen, and the board's filters, a
// setting, a manager or a worker never offer a list too long to read.

/** A page of `items` found by the words typed, as a picker searches; everything while the words are empty. */
export function listSearch<T>(
  items: readonly T[],
  matches: (item: T, words: string) => boolean,
): PickerSearch<T> {
  return async (query, page) => {
    const words = query.trim().toLowerCase();
    const found = words.length === 0 ? items : items.filter((item) => matches(item, words));
    return {
      items: found.slice(page.offset, page.offset + page.limit),
      more: found.length > page.offset + page.limit,
    };
  };
}

/** The people given, found by name or login. */
export function peopleSearch(people: readonly RestPerson[]): PickerSearch<RestPerson> {
  return listSearch(
    people,
    (person, words) =>
      personName(person).toLowerCase().includes(words) ||
      person.login.toLowerCase().includes(words),
  );
}

/** The projects given, found by name or key. */
export function projectsSearch(projects: readonly RestProject[]): PickerSearch<RestProject> {
  return listSearch(
    projects,
    (project, words) =>
      project.name.toLowerCase().includes(words) || project.key.toLowerCase().includes(words),
  );
}

/** The goals given, found by title. */
export function goalsSearch(goals: readonly RestGoal[]): PickerSearch<RestGoal> {
  return listSearch(goals, (goal, words) => goal.title.toLowerCase().includes(words));
}
