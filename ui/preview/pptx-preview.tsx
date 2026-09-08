import { useEffect, useRef, useState } from "react";
import { renderSlideToCanvas, type Presentation } from "pptx-viewer";
import { parsePptxCancellable } from "./pptx-worker.js";
type PptxState =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      presentation: Presentation;
    }
  | {
      status: "error";
      message: string;
    };
export function PptxPreview(props: { bytes: ArrayBuffer; path: string }) {
  const [state, setState] = useState<PptxState>({ status: "loading" });
  const [slideIndex, setSlideIndex] = useState(0);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const renderGenerationRef = useRef(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ status: "loading" });
    setSlideIndex(0);
    void parsePptxCancellable(props.bytes.slice(0), controller.signal)
      .then((presentation) => {
        if (active) setState({ status: "ready", presentation });
      })
      .catch((error: unknown) => {
        if (active && !controller.signal.aborted)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Presentation preview failed.",
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [props.bytes]);
  useEffect(() => {
    if (state.status !== "ready" || canvasHostRef.current === null) return;
    let active = true;
    const generation = ++renderGenerationRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      `Slide ${slideIndex + 1} of ${state.presentation.slides.length}`,
    );
    void renderSlideToCanvas(state.presentation, slideIndex, canvas)
      .then(() => {
        if (
          active &&
          renderGenerationRef.current === generation &&
          canvasHostRef.current !== null
        ) {
          canvasHostRef.current.replaceChildren(canvas);
        }
      })
      .catch((error: unknown) => {
        if (active && renderGenerationRef.current === generation)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Slide rendering failed.",
          });
      });
    return () => {
      active = false;
    };
  }, [slideIndex, state]);
  if (state.status === "loading")
    return <p role="status">Rendering presentation…</p>;
  if (state.status === "error") return <p role="alert">{state.message}</p>;
  const count = state.presentation.slides.length;
  if (count === 0) return <p role="status">This presentation has no slides.</p>;
  const move = (next: number) =>
    setSlideIndex(Math.max(0, Math.min(count - 1, next)));
  return (
    <section
      className="filetree-preview-presentation"
      aria-label={`Presentation preview of ${props.path}`}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(slideIndex - 1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          move(slideIndex + 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          move(0);
        } else if (event.key === "End") {
          event.preventDefault();
          move(count - 1);
        }
      }}
      tabIndex={0}
    >
      <div className="filetree-preview-slide-canvas" ref={canvasHostRef} />
      <div className="filetree-preview-slide-controls">
        <button
          type="button"
          disabled={slideIndex === 0}
          onClick={() => move(slideIndex - 1)}
        >
          Previous slide
        </button>
        <span aria-live="polite">
          Slide {slideIndex + 1} of {count}
        </span>
        <button
          type="button"
          disabled={slideIndex === count - 1}
          onClick={() => move(slideIndex + 1)}
        >
          Next slide
        </button>
      </div>
    </section>
  );
}
