import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { useWords } from "../i18n/index.js";
import { Button, cx, formatBytes } from "./ui.js";

// A picture put on the board is seen small where it is and large over the page: a thumbnail no
// taller than a few lines of text, and an overlay that keeps the page under it, zooms with the
// wheel, the buttons and two fingers, moves with a drag, and closes with Escape, its button or a
// click beside the picture, giving the focus back to the thumbnail that opened it. The console
// keeps a file as it was handed in and makes no smaller copy of it, so the thumbnail and the
// overlay show the same bytes, loaded once and lazily. Takes its data as props and nothing from
// the network; the overlay is rendered into the document's body, over everything.

/** A picture the pages can show: where it is read, what it is called, and how large the file is. */
export interface Picture {
  readonly src: string;
  readonly alt: string;
  readonly name: string;
  readonly size?: number | undefined;
}

/** How wide and how tall something is, in pixels: a picture by its own, the stage it is shown on. */
export interface PictureSize {
  readonly width: number;
  readonly height: number;
}

/**
 * How the picture is seen in the overlay: its scale against its own size, `1` a pixel of the
 * picture for a pixel of the page, and where its centre is, in pixels from the stage's centre.
 */
export interface PictureView {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** How far the picture zooms in: to eight times its own size. It zooms out until all of it is in view. */
export const MAX_SCALE = 8;
/** What one press of a zoom button does to the scale. */
export const ZOOM_STEP = 1.25;
/**
 * How much longer than the stage a picture is, in its shape, before it opens at the stage's
 * width and from its top, and no longer whole: a page captured from top to bottom, shown whole,
 * is a strip nobody reads.
 */
export const LONG_PICTURE = 2;
/** How far a pointer travels before a press is a drag and no longer a click. */
const DRAG_SLACK = 4;
/** How far a press of an arrow key moves the picture. */
const KEY_STEP = 80;

const measured = (size: PictureSize): boolean =>
  Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;

/**
 * The scale at which all of the picture is in view: as its own size where the stage has room
 * for that, smaller where it has not, and never larger than its own size.
 */
export function wholeScale(picture: PictureSize, stage: PictureSize): number {
  if (!measured(picture) || !measured(stage)) {
    return 1;
  }
  return Math.min(1, stage.width / picture.width, stage.height / picture.height);
}

/**
 * The view held to what there is to see: the scale between all of the picture in view and
 * eight times its own size; on an axis where the picture is no larger than the stage it stands
 * in the middle, and where it is larger its edge never comes in from the stage's.
 */
export function boundView(
  view: PictureView,
  picture: PictureSize,
  stage: PictureSize,
): PictureView {
  const least = wholeScale(picture, stage);
  const asked = Number.isFinite(view.scale) ? view.scale : least;
  const scale = Math.min(Math.max(MAX_SCALE, least), Math.max(least, asked));
  const within = (at: number, length: number, room: number): number => {
    const reach = Math.max(0, (length * scale - room) / 2);
    return Number.isFinite(at) ? Math.min(reach, Math.max(-reach, at)) : 0;
  };
  const x = within(view.x, picture.width, stage.width);
  const y = within(view.y, picture.height, stage.height);
  return scale === view.scale && x === view.x && y === view.y ? view : { scale, x, y };
}

/**
 * The picture as it first appears: all of it in view, in the middle; a picture much longer than
 * the stage as wide as the stage has room for, from its top, and one much wider as tall as the
 * stage has room for, from its left, so that what is shown can be read. Zooming out brings all
 * of it in view.
 */
export function openingView(picture: PictureSize, stage: PictureSize): PictureView {
  if (!measured(picture) || !measured(stage)) {
    return { scale: 1, x: 0, y: 0 };
  }
  const whole = wholeScale(picture, stage);
  const across = Math.min(1, stage.width / picture.width);
  const down = Math.min(1, stage.height / picture.height);
  if (across >= whole * LONG_PICTURE) {
    return boundView({ scale: across, x: 0, y: Number.MAX_SAFE_INTEGER }, picture, stage);
  }
  if (down >= whole * LONG_PICTURE) {
    return boundView({ scale: down, x: Number.MAX_SAFE_INTEGER, y: 0 }, picture, stage);
  }
  return { scale: whole, x: 0, y: 0 };
}

/**
 * The view after zooming by `factor` around a point of the stage, so that what was under the
 * pointer stays under it, as far as the picture's edges allow.
 */
export function zoomAround(
  view: PictureView,
  factor: number,
  point: { readonly x: number; readonly y: number },
  picture: PictureSize,
  stage: PictureSize,
): PictureView {
  const from = boundView(view, picture, stage);
  const scale = boundView({ ...from, scale: from.scale * factor }, picture, stage).scale;
  if (scale === from.scale) {
    return from;
  }
  const ratio = scale / from.scale;
  return boundView(
    {
      scale,
      x: point.x - (point.x - from.x) * ratio,
      y: point.y - (point.y - from.y) * ratio,
    },
    picture,
    stage,
  );
}

/** What a notch of the wheel does to the scale: in for a wheel rolled up, out for one rolled down, a step per hundred units. */
export function wheelFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 1;
  }
  return ZOOM_STEP ** (-deltaY / 100);
}

/** The view moved by a drag, as far as there is more of the picture that way. */
export function panBy(
  view: PictureView,
  dx: number,
  dy: number,
  picture: PictureSize,
  stage: PictureSize,
): PictureView {
  return boundView({ ...view, x: view.x + dx, y: view.y + dy }, picture, stage);
}

export interface PictureThumbProps {
  readonly picture: Picture;
  /** Called with the picture and the thumbnail that was pressed, so that the focus comes back to it. */
  readonly onOpen: (picture: Picture, opener: HTMLElement) => void;
  readonly className?: string | undefined;
}

/** A picture seen small where it is, which opens large over the page. */
export function PictureThumb(props: PictureThumbProps) {
  const words = useWords().pictures;
  const { picture } = props;
  return (
    <button
      type="button"
      className={cx("sc-picture-thumb", props.className)}
      aria-label={words.open(picture.name)}
      onClick={(event) => props.onOpen(picture, event.currentTarget)}
    >
      <img src={picture.src} alt={picture.alt} loading="lazy" decoding="async" draggable={false} />
    </button>
  );
}

export interface PictureOverlayProps {
  readonly picture: Picture;
  readonly onClose: () => void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The picture large, over the page: a dialog that holds the focus, with the ways to zoom, to move
 * and to close. Rendered where it is given; `Lightbox` puts it over the document.
 */
export function PictureOverlay(props: PictureOverlayProps) {
  const words = useWords().pictures;
  const { picture, onClose } = props;
  /** How the picture is seen once a person zoomed or moved it; until then, as it opens. */
  const [chosen, setChosen] = useState<PictureView | null>(null);
  /** The picture's own size, known once it has loaded, and the stage's, kept as the window changes. */
  const [size, setSize] = useState<PictureSize | null>(null);
  const [room, setRoom] = useState<PictureSize | null>(null);
  const [dragging, setDragging] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  /** The pointers on the stage, by id, where each was last seen. */
  const pointers = useRef(new Map<number, Point>());
  /** Whether the press under way has travelled: then its release is no click. */
  const moved = useRef(false);

  // The dialog takes the focus when it opens, and the page under it stops scrolling.
  useEffect(() => {
    closeButton.current?.focus();
    const { body } = document;
    const before = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = before;
    };
  }, []);

  // The stage is measured when the overlay opens and whenever its size changes.
  useEffect(() => {
    const element = stage.current;
    if (element === null) {
      return;
    }
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setRoom((before) =>
        before !== null && before.width === rect.width && before.height === rect.height
          ? before
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** The picture's own size, or the size it is drawn at where it says none of its own. */
  const sizeOf = useCallback((element: HTMLImageElement) => {
    if (element.naturalWidth > 0 && element.naturalHeight > 0) {
      setSize({ width: element.naturalWidth, height: element.naturalHeight });
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ width: rect.width, height: rect.height });
    }
  }, []);

  // A picture the thumbnail loaded already is complete before anything is heard of it.
  useEffect(() => {
    const element = image.current;
    if (element?.complete === true) {
      sizeOf(element);
    }
  }, [sizeOf]);

  const view =
    size === null || room === null
      ? null
      : boundView(chosen ?? openingView(size, room), size, room);

  /** Changes the view from what it is, once the sizes are known; nothing before. */
  const change = (
    next: (current: PictureView, picture: PictureSize, stage: PictureSize) => PictureView,
  ) => {
    if (size === null || room === null) {
      return;
    }
    setChosen((current) =>
      next(boundView(current ?? openingView(size, room), size, room), size, room),
    );
  };

  /** A point of the stage, in pixels from its centre. */
  const pointOf = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = stage.current?.getBoundingClientRect();
    if (rect === undefined) {
      return { x: 0, y: 0 };
    }
    return {
      x: event.clientX - (rect.left + rect.width / 2),
      y: event.clientY - (rect.top + rect.height / 2),
    };
  }, []);

  const zoom = (factor: number, point: Point = { x: 0, y: 0 }) =>
    change((current, own, around) => zoomAround(current, factor, point, own, around));
  const move = (dx: number, dy: number) =>
    change((current, own, around) => panBy(current, dx, dy, own, around));
  /** All of the picture in view, in the middle. */
  const whole = () => change((_, own, around) => ({ scale: wholeScale(own, around), x: 0, y: 0 }));

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    zoom(wheelFactor(event.deltaY), pointOf(event));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, pointOf(event));
    moved.current = false;
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (before === undefined) {
      return;
    }
    const now = pointOf(event);
    pointers.current.set(event.pointerId, now);
    if (!moved.current && distance(before, now) > DRAG_SLACK) {
      moved.current = true;
    }
    const others = [...pointers.current.entries()].filter(([id]) => id !== event.pointerId);
    const other = others[0]?.[1];
    if (other !== undefined) {
      // Two fingers: the picture zooms by how much they moved apart, around the point between them,
      // and moves with that point.
      const factor =
        distance(before, other) === 0 ? 1 : distance(now, other) / distance(before, other);
      const from = midpoint(before, other);
      const to = midpoint(now, other);
      change((current, own, around) =>
        zoomAround(
          panBy(current, to.x - from.x, to.y - from.y, own, around),
          factor,
          to,
          own,
          around,
        ),
      );
      return;
    }
    move(now.x - before.x, now.y - before.y);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      setDragging(false);
    }
  };

  // A click beside the picture closes the overlay; a drag that ends there does not, and neither
  // does a click on the picture. Where the click fell is read off the picture's place: the stage
  // holds the pointer while it is down, so the click is told as the stage's wherever it fell.
  const onBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    const on =
      event.target === event.currentTarget ||
      event.target === stage.current ||
      event.target === image.current;
    const rect = image.current?.getBoundingClientRect();
    const onPicture =
      rect !== undefined &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (on && !onPicture && !moved.current) {
      onClose();
    }
  };

  // A press on the picture or beside it takes the focus from nothing: it stays with the button
  // that has it, so that Escape and the keys that zoom and move are heard after a drag as before.
  const keepFocus = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element) || event.target.closest("a, button") === null) {
      event.preventDefault();
    }
  };

  // A double press looks closer where it was pressed, and from any closer view shows all of it again.
  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const point = pointOf(event);
    change((current, own, around) => {
      const least = wholeScale(own, around);
      if (current.scale > least) {
        return { scale: least, x: 0, y: 0 };
      }
      // To its own size; a picture that is all in view at its own size, to two and a half times it.
      const closer = least < 1 ? 1 : 2.5;
      return zoomAround(current, closer / current.scale, point, own, around);
    });
  };

  // Escape closes; the keys zoom and move; Tab stays within the dialog.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    const page = (room?.height ?? 0) * 0.85;
    const far = Number.MAX_SAFE_INTEGER;
    const moves: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [KEY_STEP, 0],
      ArrowRight: [-KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
      PageUp: [0, page],
      PageDown: [0, -page],
      Home: [0, far],
      End: [0, -far],
    };
    const by = moves[event.key];
    if (by !== undefined) {
      event.preventDefault();
      move(by[0], by[1]);
    } else if (event.key === "+" || event.key === "=") {
      zoom(ZOOM_STEP);
    } else if (event.key === "-") {
      zoom(1 / ZOOM_STEP);
    } else if (event.key === "0") {
      whole();
    } else if (event.key === "1") {
      // Its own size: a pixel of the picture for a pixel of the page.
      change((current, own, around) =>
        zoomAround(current, 1 / current.scale, { x: 0, y: 0 }, own, around),
      );
    } else if (event.key === "Tab" && dialog.current !== null) {
      const focusable = [
        ...dialog.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)"),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  // Drawn at the size the scale gives it, and placed by its centre: until its size is known it
  // is held within the stage by the stylesheet alone, whole and in the middle.
  const drawn =
    view === null || size === null
      ? undefined
      : {
          width: `${size.width * view.scale}px`,
          height: `${size.height * view.scale}px`,
          transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px))`,
        };
  return (
    <div
      ref={dialog}
      className="sc-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={words.label(picture.name)}
      onKeyDown={onKeyDown}
      onClick={onBackdropClick}
      onMouseDown={keepFocus}
    >
      <div className="sc-overlay-bar">
        <a
          className="sc-overlay-name"
          href={picture.src}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          title={words.file}
        >
          {picture.name}
          {picture.size !== undefined && (
            <span className="sc-muted">, {formatBytes(picture.size)}</span>
          )}
        </a>
        <div className="sc-overlay-actions">
          <Button
            variant="ghost"
            size="sm"
            aria-label={words.zoomOut}
            onClick={() => zoom(1 / ZOOM_STEP)}
          >
            −
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={words.zoomIn}
            onClick={() => zoom(ZOOM_STEP)}
          >
            +
          </Button>
          {/* The scale against the picture's own size; pressed, all of it is in view. */}
          <Button variant="ghost" size="sm" aria-label={words.fit} onClick={whole}>
            {view === null ? "–" : `${Math.round(view.scale * 100)}%`}
          </Button>
          <button
            ref={closeButton}
            type="button"
            className="sc-button sc-button-ghost sc-button-sm"
            aria-label={words.close}
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the stage is where the picture is dragged and pinched; the keys are read on the dialog around it */}
      <div
        ref={stage}
        className="sc-overlay-stage"
        role="presentation"
        data-dragging={dragging ? "true" : undefined}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <img
          ref={image}
          className={cx("sc-overlay-picture", drawn === undefined && "sc-overlay-picture-unsized")}
          src={picture.src}
          alt={picture.alt}
          decoding="async"
          draggable={false}
          style={drawn}
          onLoad={(event) => sizeOf(event.currentTarget)}
        />
      </div>
      <p className="sc-overlay-hint">{words.hint}</p>
    </div>
  );
}

export interface LightboxProps {
  /** The picture shown large, or nothing. */
  readonly picture: Picture | null;
  readonly onClose: () => void;
}

/** The overlay over the whole document, while a picture is shown; nothing otherwise, and nothing where there is no document. */
export function Lightbox(props: LightboxProps): ReactNode {
  if (props.picture === null || typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <PictureOverlay picture={props.picture} onClose={props.onClose} />,
    document.body,
  );
}

export interface PictureState {
  /** The picture shown large, or nothing. */
  readonly shown: Picture | null;
  readonly open: (picture: Picture, opener: HTMLElement) => void;
  /** Closes the overlay and gives the focus back to what opened it. */
  readonly close: () => void;
}

/** Which picture is shown large, and the ways to show one and to close it. */
export function usePicture(): PictureState {
  const [shown, setShown] = useState<Picture | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((picture: Picture, element: HTMLElement) => {
    opener.current = element;
    setShown(picture);
  }, []);
  const close = useCallback(() => {
    const back = opener.current;
    opener.current = null;
    setShown(null);
    // The focus returns once the overlay is gone, so that it is not taken back by it.
    if (back !== null) {
      setTimeout(() => back.focus(), 0);
    }
  }, []);
  return { shown, open, close };
}
