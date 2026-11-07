import type { PluginWidgetSizeName } from "./plugin/bridge.js";
import { widgetSizesOf } from "./plugin/manifest.js";
import type { RestHomeWidget, RestPlugin, RestPluginWidget } from "./schemas.js";

// The front page's widgets as a person arranges them (ADR-0059): which, how large, in what
// order, above or below the projects. The manifests say what there is and how each starts; the
// person's arrangement, kept on `me.home`, says what they chose; what a person may no longer see
// (a role gone, a plugin disabled) drops out quietly. Pure functions, so that the page and the
// tests read the same arrangement.

export type WidgetPlace = "home:top" | "home:bottom";

/** A widget a person may see, with the plugin it belongs to. */
export interface AvailableWidget {
  readonly plugin: RestPlugin;
  readonly widget: RestPluginWidget;
}

/** One widget as the page shows it: the entry of the arrangement, resolved. */
export interface ShownWidget extends AvailableWidget {
  readonly entry: RestHomeWidget;
  readonly size: PluginWidgetSizeName;
  readonly place: WidgetPlace;
  /** The sizes the person may give it. */
  readonly sizes: readonly PluginWidgetSizeName[];
}

/**
 * Every widget the person may see, in the plugins' order: those they hold a role for, of the
 * plugins that are on. An administrator reads every plugin installed, and one that is off has no
 * frame to show.
 */
export function availableWidgets(plugins: readonly RestPlugin[]): AvailableWidget[] {
  return plugins
    .filter((plugin) => plugin.state === "enabled")
    .flatMap((plugin) => plugin.widgets.map((widget) => ({ plugin, widget })));
}

/** The manifests' arrangement: every widget at its place, at the size it starts at. */
export function defaultArrangement(plugins: readonly RestPlugin[]): RestHomeWidget[] {
  return availableWidgets(plugins).map(({ plugin, widget }) => ({
    plugin: plugin.key,
    widget: widget.key,
    size: widgetSizesOf(widget).defaultSize,
    place: widget.place,
  }));
}

const sameWidget = (entry: RestHomeWidget, other: RestHomeWidget): boolean =>
  entry.plugin === other.plugin && entry.widget === other.widget;

/**
 * The arrangement as the page shows it: the person's where they kept one, else the manifests';
 * a widget the person may no longer see drops out, a size the widget no longer comes in becomes
 * the one it starts at, and a widget named twice is shown once.
 */
export function arrangementShown(
  plugins: readonly RestPlugin[],
  arrangement: readonly RestHomeWidget[] | null | undefined,
): ShownWidget[] {
  const available = availableWidgets(plugins);
  const entries = arrangement ?? defaultArrangement(plugins);
  const shown: ShownWidget[] = [];
  for (const entry of entries) {
    if (shown.some((candidate) => sameWidget(candidate.entry, entry))) {
      continue;
    }
    const found = available.find(
      ({ plugin, widget }) => plugin.key === entry.plugin && widget.key === entry.widget,
    );
    if (found === undefined) {
      continue;
    }
    const { sizes, defaultSize } = widgetSizesOf(found.widget);
    shown.push({
      ...found,
      entry,
      size: sizes.includes(entry.size) ? entry.size : defaultSize,
      place: entry.place ?? found.widget.place,
      sizes,
    });
  }
  return shown;
}

/** The arrangement with one widget's size changed. */
export function resized(
  arrangement: readonly RestHomeWidget[],
  entry: RestHomeWidget,
  size: PluginWidgetSizeName,
): RestHomeWidget[] {
  return arrangement.map((candidate) =>
    sameWidget(candidate, entry) ? { ...candidate, size } : candidate,
  );
}

/** The arrangement without one widget. */
export function removed(
  arrangement: readonly RestHomeWidget[],
  entry: RestHomeWidget,
): RestHomeWidget[] {
  return arrangement.filter((candidate) => !sameWidget(candidate, entry));
}

/** The arrangement with a widget added at a place, at the size it starts at; one already there stays as it is. */
export function added(
  arrangement: readonly RestHomeWidget[],
  widget: AvailableWidget,
  place: WidgetPlace,
): RestHomeWidget[] {
  const entry: RestHomeWidget = {
    plugin: widget.plugin.key,
    widget: widget.widget.key,
    size: widgetSizesOf(widget.widget).defaultSize,
    place,
  };
  return arrangement.some((candidate) => sameWidget(candidate, entry))
    ? [...arrangement]
    : [...arrangement, entry];
}

/**
 * The arrangement with one widget moved before another at the same place, or to the end of the
 * place when `before` is left out; the other places keep their order.
 */
export function moved(
  arrangement: readonly RestHomeWidget[],
  entry: RestHomeWidget,
  before: RestHomeWidget | undefined,
): RestHomeWidget[] {
  const without = arrangement.filter((candidate) => !sameWidget(candidate, entry));
  const moving = arrangement.find((candidate) => sameWidget(candidate, entry));
  if (moving === undefined) {
    return [...arrangement];
  }
  if (before === undefined) {
    return [...without, moving];
  }
  const at = without.findIndex((candidate) => sameWidget(candidate, before));
  if (at === -1) {
    return [...without, moving];
  }
  return [...without.slice(0, at), moving, ...without.slice(at)];
}

/** The widgets not in the arrangement yet, which the person may add. */
export function addable(
  plugins: readonly RestPlugin[],
  arrangement: readonly RestHomeWidget[],
): AvailableWidget[] {
  return availableWidgets(plugins).filter(
    ({ plugin, widget }) =>
      !arrangement.some((entry) => entry.plugin === plugin.key && entry.widget === widget.key),
  );
}
