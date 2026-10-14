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

/** How the picture is seen in the overlay: its scale, and where its centre is, in pixels from the stage's centre. */
export interface PictureView {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** How far the picture zooms: from fitting the stage to eight times that. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 8;
/** What one press of a zoom button does to the scale. */
export const ZOOM_STEP = 1.25;
/** How far a pointer travels before a press is a drag and no longer a click. */
const DRAG_SLACK = 4;

/** The picture as it first appears: fitted to the stage, centred. */
export const FITTED: PictureView = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return MIN_SCALE;
  }
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The view after zooming by `factor` around a point of the stage, so that what was under the
 * pointer stays under it. Zooming back to the fitted scale puts the picture back in the centre.
 */
export function zoomAround(
  view: PictureView,
  factor: number,
  point: { readonly x: number; readonly y: number },
): PictureView {
  const scale = clampScale(view.scale * factor);
  if (scale === view.scale) {
    return view;
  }
  if (scale === MIN_SCALE) {
    return FITTED;
  }
  const ratio = scale / view.scale;
  return {
    scale,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  };
}

/** What a notch of the wheel does to the scale: in for a wheel rolled up, out for one rolled down, a step per hundred units. */
export function wheelFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 1;
  }
  return ZOOM_STEP ** (-deltaY / 100);
}

/** The view moved by a drag; a fitted picture stays where it is. */
export function panBy(view: PictureView, dx: number, dy: number): PictureView {
  if (view.scale === MIN_SCALE) {
    return view;
  }
  return { ...view, x: view.x + dx, y: view.y + dy };
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
  const [view, setView] = useState<PictureView>(FITTED);
  const [dragging, setDragging] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
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
    setView((current) => zoomAround(current, factor, point));

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
      setView((current) => zoomAround(panBy(current, to.x - from.x, to.y - from.y), factor, to));
      return;
    }
    setView((current) => panBy(current, now.x - before.x, now.y - before.y));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      setDragging(false);
    }
  };

  // A click beside the picture closes the overlay; a drag that ends there does not.
  const onBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    const beside = event.target === event.currentTarget || event.target === stage.current;
    if (beside && !moved.current) {
      onClose();
    }
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const point = pointOf(event);
    setView((current) => (current.scale > MIN_SCALE ? FITTED : zoomAround(current, 2.5, point)));
  };

  // Escape closes; the keys zoom; Tab stays within the dialog.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      zoom(ZOOM_STEP);
    } else if (event.key === "-") {
      zoom(1 / ZOOM_STEP);
    } else if (event.key === "0") {
      setView(FITTED);
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

  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  return (
    <div
      ref={dialog}
      className="sc-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={words.label(picture.name)}
      onKeyDown={onKeyDown}
      onClick={onBackdropClick}
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
          <Button variant="ghost" size="sm" aria-label={words.fit} onClick={() => setView(FITTED)}>
            {Math.round(view.scale * 100)}%
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
          className="sc-overlay-picture"
          src={picture.src}
          alt={picture.alt}
          decoding="async"
          draggable={false}
          style={{ transform }}
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
